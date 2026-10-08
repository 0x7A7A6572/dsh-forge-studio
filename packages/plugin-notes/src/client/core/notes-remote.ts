/**
 * notes 远程通道（client → host）：端点 method 名与参数 wire 名须与 host
 * NotesService 一致；手写的响应类型是 host 契约的镜像。
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
  NoteModelSelection,
  NoteRecord,
  NoteRun,
  NoteScheduleInput,
  NoteUpdateInput,
  ScheduleMode,
  TaskStatus,
  TaskTargets,
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

/** 与 types.ts 的 TaskStatus 同步；此处写死以避开 host 域 import。 */
const TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed'] as const

/** host agent 桥装配状态镜像；waiting = tools 服务未就绪。 */
export type ClientNotesAgentBridgeState =
  | { readonly status: 'waiting' }
  | { readonly status: 'installed'; readonly at: number }
  | { readonly status: 'failed'; readonly at: number; readonly reason: string }

/**
 * strict codec：同时给 create 与 schema 两代字段，兼容新旧 dsh
 * （0.1.6-alpha 起读 create，0.1.5-rc.2 及更早读 schema）。
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

/** 历史紫色归一为灰（见 normalizeNoteColor）。 */
function parseOptionalColor(value: unknown): NoteColor | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeNoteColor(value)
  if (normalized === undefined) {
    throw new Error(`expected color in ${NOTE_COLORS.join('|')}`)
  }
  return normalized
}

function parseOptionalTaskStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !(TASK_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`expected status in ${TASK_STATUSES.join('|')}`)
  }
  return value as TaskStatus
}

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

function parseOptionalModel(value: unknown): NoteModelSelection | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('expected model object')
  if (typeof value.provider !== 'string' || value.provider === '') throw new Error('expected model.provider: string')
  if (typeof value.model !== 'string' || value.model === '') throw new Error('expected model.model: string')
  if (value.reasoningEffort !== undefined && typeof value.reasoningEffort !== 'string') {
    throw new Error('expected model.reasoningEffort?: string')
  }
  return {
    provider: value.provider,
    model: value.model,
    ...(value.reasoningEffort !== undefined ? { reasoningEffort: value.reasoningEffort } : {}),
  }
}

/**
 * agentPreset 空串 = 清除（host trim 后为空即删字段）；
 * model null = 清除，对象 = 整体替换。
 */
function parseOptionalLane(value: unknown): {
  status?: TaskStatus
  run?: NoteRun
  clear?: true
  agentPreset?: string
  model?: NoteModelSelection | null
} | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('expected lane object')
  const status = parseOptionalTaskStatus(value.status)
  const run = parseOptionalRun(value.run)
  let clear: true | undefined
  if (value.clear !== undefined) {
    if (value.clear !== true) throw new Error('expected lane.clear === true')
    clear = true
  }
  if (value.agentPreset !== undefined && typeof value.agentPreset !== 'string') {
    throw new Error('expected lane.agentPreset?: string')
  }
  const model = value.model === null ? null : parseOptionalModel(value.model)
  return {
    ...(status !== undefined ? { status } : {}),
    ...(run !== undefined ? { run } : {}),
    ...(clear !== undefined ? { clear } : {}),
    ...(value.agentPreset !== undefined ? { agentPreset: value.agentPreset } : {}),
    ...(model !== undefined ? { model } : {}),
  }
}

/** null = 清除（仅 update）；语义校验归 host sanitizeSchedule，此处只管形状。 */
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
    if (value.agentPreset !== undefined && typeof value.agentPreset !== 'string') {
      throw new Error('expected agentPreset?: string')
    }
    const schedule = parseOptionalSchedule(value.schedule)
    if (schedule === null) throw new Error('expected schedule object')
    const model = parseOptionalModel(value.model)
    return {
      title: value.title,
      text: value.text,
      color: parseOptionalColor(value.color),
      ...(value.laneStatus !== undefined ? { laneStatus: parseOptionalTaskStatus(value.laneStatus) } : {}),
      ...(value.workspace !== undefined ? { workspace: value.workspace } : {}),
      ...(value.agentPreset !== undefined ? { agentPreset: value.agentPreset } : {}),
      ...(model !== undefined ? { model } : {}),
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
    // workspace 空串 = 清除（host trim 后为空即删字段）。
    if (value.workspace !== undefined && typeof value.workspace !== 'string') throw new Error('expected workspace?: string')
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

const json: TypertCodec = { mode: 'src-json' }

/** 与 host NotesService.taskExecute 的返回值同形状（reason 取值须同步）。 */
export type TaskExecuteResult =
  | { readonly ok: true; readonly note: NoteRecord }
  | {
      readonly ok: false
      readonly reason: 'missing' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed'
    }

export type TaskResetResult = { readonly ok: true; readonly note: NoteRecord } | { readonly ok: false }

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
    // 执行投递给 host 按工作区新建的会话，故无 sessionId。
    descriptor('taskExecute', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
    ]),
    // 工作区候选：最近会话用过的 cwd；永不抛，降级空数组。
    descriptor('listWorkspaces', []),
    // 任务执行目标目录；永不抛，降级空目录。
    descriptor('taskTargets', []),
    descriptor('taskReset', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
    ]),
    descriptor('watch', [], { mode: 'stream' }),
    // WebDAV：网络错误结构化回传，不抛。
    descriptor('webdavBackup', []),
    descriptor('webdavList', []),
    descriptor('webdavStatus', []),
    descriptor('webdavRestore', [
      { name: 'name', wire: 'name', source: 'json', codec: strict('SnapshotName', idSchema) },
    ]),
  ],
}

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
    'notes/taskTargets': () => Promise<RemoteResult<TaskTargets>>
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

export interface NotesRemote {
  /** 事件驱动：收到后自行 list() 拉最新。 */
  watch(signal?: AbortSignal): AsyncIterable<NotesChangeEvent>
  list(): Promise<RemoteResult<readonly NoteRecord[]>>
  getAgentBridgeState(): Promise<RemoteResult<ClientNotesAgentBridgeState>>
  create(input: NoteCreateInput): Promise<RemoteResult<NoteRecord>>
  update(id: NoteId, patch: NoteUpdateInput): Promise<RemoteResult<NoteRecord | undefined>>
  setPinned(id: NoteId, pinned: boolean): Promise<RemoteResult<NoteRecord | undefined>>
  delete(id: NoteId): Promise<RemoteResult<boolean>>
  taskExecute(id: NoteId): Promise<RemoteResult<TaskExecuteResult>>
  listWorkspaces(): Promise<RemoteResult<readonly string[]>>
  taskTargets(): Promise<RemoteResult<TaskTargets>>
  taskReset(id: NoteId): Promise<RemoteResult<TaskResetResult>>
  webdavBackup(): Promise<RemoteResult<WebdavBackupResult>>
  webdavList(): Promise<RemoteResult<WebdavListResult>>
  webdavStatus(): Promise<RemoteResult<WebdavStatus>>
  webdavRestore(name: string): Promise<RemoteResult<WebdavRestoreResult>>
}

/** 挂载 notes 远程命名空间；await 完成后才能用 notesOf。 */
export async function mountNotesRemote(ctx: Context): Promise<() => Promise<void>> {
  return ctx.remote.$mount(notesRemoteContribution)
}

export function notesOf(ctx: Context): NotesRemote {
  return (ctx.remote as ClientRemote & { notes: NotesRemote }).notes
}