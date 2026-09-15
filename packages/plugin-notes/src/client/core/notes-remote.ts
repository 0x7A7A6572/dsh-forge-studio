/**
 * notes 远程通道（client → host，Typert Gateway 直连，不走会话）：
 * - host 侧 NotesService 以 SRC 标记模式暴露 `notes/*` 端点（见 service.ts）。
 * - 本文件手写对应的 client 贡献：ctx.remote.$mount 后即可
 *   `ctx.remote.notes.list()` 等直接读写，与 agent 对话完全解耦。
 *
 * 约束（两处必须与 host 一致）：
 * - 端点 method 名 = host 方法名（list/create/update/setPinned/delete）；
 * - 参数 wire 名 = host 方法形参名（input/id/patch/pinned）。
 * 参数 codec 必须 strict（client API 层强制），result 用 src-json（透传）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertCodec,
  TypertRemoteContribution,
  TypertRemoteNamespace,
  TypertSchema,
} from '@deepseek-ai/dsh-typert-protocol'
import { normalizeNoteColor, NOTE_COLORS, SCHEDULE_MODES } from '../../types.ts'
import type {
  NoteColor,
  NoteCreateInput,
  NoteId,
  NoteRecord,
  NoteRun,
  NoteScheduleInput,
  NoteUpdateInput,
  ScheduleMode,
  TaskStatus,
} from '../../types.ts'
import type {
  WebdavBackupResult,
  WebdavListResult,
  WebdavRestoreResult,
  WebdavStatus,
} from '../../types.ts'

export const NOTES_REMOTE_PACKAGE = '@zzerx/dsh-plugin-notes'
const SERVICE = 'notes'
const NAMESPACE = 'notes'

/**
 * 任务状态枚举（与 types.ts 的 TaskStatus 保持同步）。client 侧写死以避开对
 * host 域（domain.ts，依赖 storage-domain/zod）的运行时 import；改动 TaskStatus
 * 时须同步此处。
 */
const TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed'] as const

/**
 * host 侧 agent 桥装配状态镜像（手写以避免 import host 的 agent 模块）。
 * 与 src/agent/bridge-state.ts 的 NotesAgentBridgeState 形状保持一致；改动需同步。
 * waiting：tools 服务未就绪（纯 UI 宿主）；installed：notes_* 工具已注册；
 * failed：注册失败（reason 人类可读），此时会话侧无 notes_* 工具。
 */
export type ClientNotesAgentBridgeState =
  | { readonly status: 'waiting' }
  | { readonly status: 'installed'; readonly at: number }
  | { readonly status: 'failed'; readonly at: number; readonly reason: string }

/* ---------- 手写 strict codec（无需 zod；只做形状校验） ---------- */

/**
 * strict codec（手写，无需 zod；只做形状校验）。
 *
 * 同时给出两代契约字段，兼容新旧 dsh：
 * - `create`：dsh >= 0.1.6-alpha 的 typert 校验要求 strict codec 带 create() 工厂，
 *   边界首次使用时惰性取 schema（HEAD 只读这个字段）；
 * - `schema`：0.1.5-rc.2 及更早直接读 schema.parse。
 * schema 是常量对象，create() 直接复用，无额外开销。
 */
function strict<T>(typeSymbol: string, schema: TypertSchema<T>): TypertCodec {
  return { mode: 'strict', typeSymbol, create: () => schema, schema } as unknown as TypertCodec
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const idSchema: TypertSchema<NoteId> = {
  parse(value) {
    if (typeof value !== 'string' || value.length === 0) throw new Error('expected non-empty NoteId string')
    return value as NoteId
  },
}

const booleanSchema: TypertSchema<boolean> = {
  parse(value) {
    if (typeof value !== 'boolean') throw new Error('expected boolean')
    return value
  },
}

/** 可选 color 字段校验：undefined 放行；历史紫色归一为灰；其余必须是五色之一。 */
function parseOptionalColor(value: unknown): NoteColor | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeNoteColor(value)
  if (normalized === undefined) {
    throw new Error(`expected color in ${NOTE_COLORS.join('|')}`)
  }
  return normalized
}

/** 可选 lane.status 字段校验：undefined 放行；必须是五状态之一。 */
function parseOptionalTaskStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !(TASK_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`expected status in ${TASK_STATUSES.join('|')}`)
  }
  return value as TaskStatus
}

/** 可选 run 帧校验：startedAt number 必填，finishedAt/ok/summary 可选（strict）。 */
function parseOptionalRun(value: unknown): NoteRun | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('expected run object')
  if (typeof value.startedAt !== 'number') throw new Error('expected run.startedAt: number')
  if (value.finishedAt !== undefined && typeof value.finishedAt !== 'number') throw new Error('expected run.finishedAt?: number')
  if (value.ok !== undefined && typeof value.ok !== 'boolean') throw new Error('expected run.ok?: boolean')
  if (value.summary !== undefined && typeof value.summary !== 'string') throw new Error('expected run.summary?: string')
  return {
    startedAt: value.startedAt,
    ...(value.finishedAt !== undefined ? { finishedAt: value.finishedAt } : {}),
    ...(value.ok !== undefined ? { ok: value.ok } : {}),
    ...(value.summary !== undefined ? { summary: value.summary } : {}),
  }
}

/**
 * 可选 lane patch 校验：status/run/clear 均可选；undefined 字段被丢弃
 * （run: undefined 不出现）。clear 只接受布尔字面量 true（取消任务）；false /
 * 其它值一律拒绝（避免「clear: false」被误当成取消，或静默吞掉歧义输入）。
 */
function parseOptionalLane(value: unknown): { status?: TaskStatus; run?: NoteRun; clear?: true } | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('expected lane object')
  const status = parseOptionalTaskStatus(value.status)
  const run = parseOptionalRun(value.run)
  let clear: true | undefined
  if (value.clear !== undefined) {
    if (value.clear !== true) throw new Error('expected lane.clear === true')
    clear = true
  }
  return {
    ...(status !== undefined ? { status } : {}),
    ...(run !== undefined ? { run } : {}),
    ...(clear !== undefined ? { clear } : {}),
  }
}

/**
 * 可选 schedule 校验（strict 形状）：undefined 放行；null 表示「清除」（仅 update 用，
 * create 侧由调用点拒绝）；对象则逐字段校验——语义合法性（如每周是否给了星期）留给
 * host 的 sanitizeSchedule，这里只保证「不会把垃圾形状写进库」。
 */
function parseOptionalSchedule(value: unknown): NoteScheduleInput | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!isRecord(value)) throw new Error('expected schedule object')
  if (typeof value.enabled !== 'boolean') throw new Error('expected schedule.enabled: boolean')
  if (typeof value.mode !== 'string' || !(SCHEDULE_MODES as readonly string[]).includes(value.mode)) {
    throw new Error(`expected schedule.mode in ${SCHEDULE_MODES.join('|')}`)
  }
  const optionalNumber = (raw: unknown, name: string): number | undefined => {
    if (raw === undefined) return undefined
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`expected ${name}: number`)
    return raw
  }
  if (value.time !== undefined && typeof value.time !== 'string') throw new Error('expected schedule.time?: string')
  if (value.lastResult !== undefined && typeof value.lastResult !== 'string') {
    throw new Error('expected schedule.lastResult?: string')
  }
  let weekdays: number[] | undefined
  if (value.weekdays !== undefined) {
    if (!Array.isArray(value.weekdays)) throw new Error('expected schedule.weekdays?: number[]')
    weekdays = value.weekdays.map((day) => {
      if (typeof day !== 'number' || !Number.isInteger(day)) throw new Error('expected schedule.weekdays entries: integer')
      return day
    })
  }
  const at = optionalNumber(value.at, 'schedule.at')
  const everyMin = optionalNumber(value.everyMin, 'schedule.everyMin')
  const monthDay = optionalNumber(value.monthDay, 'schedule.monthDay')
  const nextAt = optionalNumber(value.nextAt, 'schedule.nextAt')
  const lastFiredAt = optionalNumber(value.lastFiredAt, 'schedule.lastFiredAt')
  const failureStreak = optionalNumber(value.failureStreak, 'schedule.failureStreak')
  const runCount = optionalNumber(value.runCount, 'schedule.runCount')
  return {
    enabled: value.enabled,
    mode: value.mode as ScheduleMode,
    ...(at !== undefined ? { at } : {}),
    ...(everyMin !== undefined ? { everyMin } : {}),
    ...(value.time !== undefined ? { time: value.time } : {}),
    ...(weekdays !== undefined ? { weekdays } : {}),
    ...(monthDay !== undefined ? { monthDay } : {}),
    ...(nextAt !== undefined ? { nextAt } : {}),
    ...(lastFiredAt !== undefined ? { lastFiredAt } : {}),
    ...(value.lastResult !== undefined ? { lastResult: value.lastResult } : {}),
    ...(failureStreak !== undefined ? { failureStreak } : {}),
    ...(runCount !== undefined ? { runCount } : {}),
  }
}

const createInputSchema: TypertSchema<NoteCreateInput> = {
  parse(value) {
    if (!isRecord(value) || typeof value.text !== 'string') throw new Error('expected { text: string }')
    if (value.title !== undefined && typeof value.title !== 'string') throw new Error('expected title?: string')
    if (value.workspace !== undefined && typeof value.workspace !== 'string') throw new Error('expected workspace?: string')
    // 新建不接受 null（没有「清除」语义），只接受对象或缺省。
    const schedule = parseOptionalSchedule(value.schedule)
    if (schedule === null) throw new Error('expected schedule object')
    return {
      title: value.title,
      text: value.text,
      color: parseOptionalColor(value.color),
      ...(value.laneStatus !== undefined ? { laneStatus: parseOptionalTaskStatus(value.laneStatus) } : {}),
      ...(value.workspace !== undefined ? { workspace: value.workspace } : {}),
      ...(schedule !== undefined ? { schedule } : {}),
    }
  },
}

const updateInputSchema: TypertSchema<NoteUpdateInput> = {
  parse(value) {
    if (!isRecord(value)) throw new Error('expected patch object')
    if (value.title !== undefined && typeof value.title !== 'string') throw new Error('expected title?: string')
    if (value.text !== undefined && typeof value.text !== 'string') throw new Error('expected text?: string')
    if (value.pinned !== undefined && typeof value.pinned !== 'boolean') throw new Error('expected pinned?: boolean')
    if (value.archived !== undefined && typeof value.archived !== 'boolean') throw new Error('expected archived?: boolean')
    // workspace：字符串透传；空串是「清除」信号（host 侧 trim 后为空即删字段）。
    if (value.workspace !== undefined && typeof value.workspace !== 'string') throw new Error('expected workspace?: string')
    // schedule：undefined 放行（保留原值）；null = 清除（取消定时）；对象 = 整体替换。
    const schedule = parseOptionalSchedule(value.schedule)
    return {
      title: value.title,
      text: value.text,
      pinned: value.pinned,
      archived: value.archived,
      color: parseOptionalColor(value.color),
      ...(value.lane !== undefined ? { lane: parseOptionalLane(value.lane) } : {}),
      ...(value.workspace !== undefined ? { workspace: value.workspace } : {}),
      ...(schedule !== undefined ? { schedule } : {}),
    }
  },
}

/** 结果一律 src-json（client 不解析返回值，host SRC 模式同样透传）。 */
const json: TypertCodec = { mode: 'src-json' }

/** 任务执行事务结果（与 host NotesService.taskExecute 返回值一致，client 不解析）。 */
export type TaskExecuteResult =
  | { readonly ok: true; readonly note: NoteRecord }
  | {
      readonly ok: false
      readonly reason: 'missing' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed'
    }

/** 任务重置结果（与 host NotesService.taskReset 返回值一致，client 不解析）。 */
export type TaskResetResult = { readonly ok: true; readonly note: NoteRecord } | { readonly ok: false }

/* ---------- 端点 descriptors（与 host NotesService 方法一一对应） ---------- */

interface DescriptorOptions {
  readonly mode?: 'stream'
}

function descriptor(
  method: string,
  parameters: InvocationDescriptor['parameters'],
  options?: DescriptorOptions,
): InvocationDescriptor {
  return {
    id: `notes.${method}`,
    service: SERVICE,
    namespace: NAMESPACE,
    method,
    ...(options?.mode !== undefined ? { mode: options.mode } : {}),
    invocation: { kind: 'direct' },
    ...(options?.mode === 'stream' ? { cancellation: { parameter: 'signal' } } : {}),
    parameters,
    result: json,
  }
}

export const notesRemoteContribution: TypertRemoteContribution = {
  package: NOTES_REMOTE_PACKAGE,
  descriptors: [
    descriptor('list', []),
    descriptor('getAgentBridgeState', []),
    descriptor('create', [
      { name: 'input', wire: 'input', source: 'json', codec: strict('NoteCreateInput', createInputSchema) },
    ]),
    descriptor('update', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
      { name: 'patch', wire: 'patch', source: 'json', codec: strict('NoteUpdateInput', updateInputSchema) },
    ]),
    descriptor('setPinned', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
      { name: 'pinned', wire: 'pinned', source: 'json', codec: strict('boolean', booleanSchema) },
    ]),
    descriptor('delete', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
    ]),
    // 执行 = host 按工作区新建会话后投递（不再向承载便签板的会话投递，故无 sessionId）。
    descriptor('taskExecute', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
    ]),
    // 工作区候选（最近会话用过的 cwd，供设置/编辑器下拉）：只读、永不抛（降级空数组）。
    descriptor('listWorkspaces', []),
    descriptor('taskReset', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
    ]),
    // 变更推送流（host SRC marker mode: 'stream'）：无业务参数，取消经 signal。
    descriptor('watch', [], { mode: 'stream' }),
    // WebDAV 备份/恢复（结果一律 src-json；网络错误结构化回传，不抛）。
    descriptor('webdavBackup', []),
    descriptor('webdavList', []),
    descriptor('webdavStatus', []),
    descriptor('webdavRestore', [
      { name: 'name', wire: 'name', source: 'json', codec: strict('SnapshotName', idSchema) },
    ]),
  ],
}

/* ---------- 类型增广：ctx.remote.notes 有类型 ---------- */

/** notes/watch 推送事件（host 与 client 同形状，src-json 透传）。 */
export interface NotesChangeEvent {
  readonly changedAt: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'notes/watch': (signal?: AbortSignal) => AsyncIterable<NotesChangeEvent>
    'notes/list': () => Promise<RemoteResult<readonly NoteRecord[]>>
    'notes/getAgentBridgeState': () => Promise<RemoteResult<ClientNotesAgentBridgeState>>
    'notes/create': (input: NoteCreateInput) => Promise<RemoteResult<NoteRecord>>
    'notes/update': (id: NoteId, patch: NoteUpdateInput) => Promise<RemoteResult<NoteRecord | undefined>>
    'notes/setPinned': (id: NoteId, pinned: boolean) => Promise<RemoteResult<NoteRecord | undefined>>
    'notes/delete': (id: NoteId) => Promise<RemoteResult<boolean>>
    'notes/taskExecute': (id: NoteId) => Promise<RemoteResult<TaskExecuteResult>>
    'notes/listWorkspaces': () => Promise<RemoteResult<readonly string[]>>
    'notes/taskReset': (id: NoteId) => Promise<RemoteResult<TaskResetResult>>
    'notes/webdavBackup': () => Promise<RemoteResult<WebdavBackupResult>>
    'notes/webdavList': () => Promise<RemoteResult<WebdavListResult>>
    'notes/webdavStatus': () => Promise<RemoteResult<WebdavStatus>>
    'notes/webdavRestore': (name: string) => Promise<RemoteResult<WebdavRestoreResult>>
  }
  interface TypertRemoteNamespaceMap {
    notes: TypertRemoteNamespace<'notes'>
  }
}

/** 供 UI 使用的窄接口（与增广的 ctx.remote.notes 形状一致）。 */
export interface NotesRemote {
  /** 变更推送流（事件驱动）：收到事件后自行 list() 拉最新；signal abort 即停。 */
  watch(signal?: AbortSignal): AsyncIterable<NotesChangeEvent>
  list(): Promise<RemoteResult<readonly NoteRecord[]>>
  getAgentBridgeState(): Promise<RemoteResult<ClientNotesAgentBridgeState>>
  create(input: NoteCreateInput): Promise<RemoteResult<NoteRecord>>
  update(id: NoteId, patch: NoteUpdateInput): Promise<RemoteResult<NoteRecord | undefined>>
  setPinned(id: NoteId, pinned: boolean): Promise<RemoteResult<NoteRecord | undefined>>
  delete(id: NoteId): Promise<RemoteResult<boolean>>
  taskExecute(id: NoteId): Promise<RemoteResult<TaskExecuteResult>>
  listWorkspaces(): Promise<RemoteResult<readonly string[]>>
  taskReset(id: NoteId): Promise<RemoteResult<TaskResetResult>>
  webdavBackup(): Promise<RemoteResult<WebdavBackupResult>>
  webdavList(): Promise<RemoteResult<WebdavListResult>>
  webdavStatus(): Promise<RemoteResult<WebdavStatus>>
  webdavRestore(name: string): Promise<RemoteResult<WebdavRestoreResult>>
}

/**
 * 挂载 notes 远程命名空间。await 完成后方可调用 notesOf(ctx)。
 * @returns 卸载函数（随调用 fiber 的 effect 自动回收）。
 */
export async function mountNotesRemote(ctx: Context): Promise<() => Promise<void>> {
  return ctx.remote.$mount(notesRemoteContribution)
}

/** 取已挂载的 notes 远程命名空间（须在 mountNotesRemote 完成后调用）。 */
export function notesOf(ctx: Context): NotesRemote {
  return (ctx.remote as ClientRemote & { notes: NotesRemote }).notes
}