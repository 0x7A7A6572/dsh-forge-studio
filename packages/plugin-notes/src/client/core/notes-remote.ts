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
import { normalizeNoteColor, NOTE_COLORS } from '../../types.ts'
import type {
  NoteColor,
  NoteCreateInput,
  NoteId,
  NoteRecord,
  NoteRun,
  NoteUpdateInput,
  TaskStatus,
} from '../../types.ts'

export const NOTES_REMOTE_PACKAGE = '@forge-studio/dsh-plugin-notes'
const SERVICE = 'notes'
const NAMESPACE = 'notes'

/**
 * 任务状态枚举（与 types.ts 的 TaskStatus 保持同步）。client 侧写死以避开对
 * host 域（domain.ts，依赖 storage-domain/zod）的运行时 import；改动 TaskStatus
 * 时须同步此处。
 */
const TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed'] as const

/* ---------- 手写 strict codec（无需 zod；只做形状校验） ---------- */

function strict<T>(typeSymbol: string, schema: TypertSchema<T>): TypertCodec {
  return { mode: 'strict', typeSymbol, schema }
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

/** sessionId 字段校验：非空字符串（任务执行投递会话标识）。 */
const sessionIdSchema: TypertSchema<string> = {
  parse(value) {
    if (typeof value !== 'string') throw new Error('expected non-empty sessionId string')
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

/** 可选 lane patch 校验：status/run 均可选；undefined 字段被丢弃（run: undefined 不出现）。 */
function parseOptionalLane(value: unknown): { status?: TaskStatus; run?: NoteRun } | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('expected lane object')
  const status = parseOptionalTaskStatus(value.status)
  const run = parseOptionalRun(value.run)
  return {
    ...(status !== undefined ? { status } : {}),
    ...(run !== undefined ? { run } : {}),
  }
}

const createInputSchema: TypertSchema<NoteCreateInput> = {
  parse(value) {
    if (!isRecord(value) || typeof value.text !== 'string') throw new Error('expected { text: string }')
    if (value.title !== undefined && typeof value.title !== 'string') throw new Error('expected title?: string')
    return {
      title: value.title,
      text: value.text,
      color: parseOptionalColor(value.color),
      ...(value.laneStatus !== undefined ? { laneStatus: parseOptionalTaskStatus(value.laneStatus) } : {}),
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
    return {
      title: value.title,
      text: value.text,
      pinned: value.pinned,
      archived: value.archived,
      color: parseOptionalColor(value.color),
      ...(value.lane !== undefined ? { lane: parseOptionalLane(value.lane) } : {}),
    }
  },
}

/** 结果一律 src-json（client 不解析返回值，host SRC 模式同样透传）。 */
const json: TypertCodec = { mode: 'src-json' }

/** 任务执行事务结果（与 host NotesService.taskExecute 返回值一致，client 不解析）。 */
export type TaskExecuteResult =
  | { readonly ok: true; readonly note: NoteRecord }
  | { readonly ok: false; readonly reason: 'missing' | 'busy' | 'no-dispatch' | 'dispatch-failed' }

/** 任务重置结果（与 host NotesService.taskReset 返回值一致，client 不解析）。 */
export type TaskResetResult = { readonly ok: true; readonly note: NoteRecord } | { readonly ok: false }

/* ---------- 端点 descriptors（与 host NotesService 方法一一对应） ---------- */

function descriptor(
  method: string,
  parameters: InvocationDescriptor['parameters'],
): InvocationDescriptor {
  return {
    id: `notes.${method}`,
    service: SERVICE,
    namespace: NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: json,
  }
}

export const notesRemoteContribution: TypertRemoteContribution = {
  package: NOTES_REMOTE_PACKAGE,
  descriptors: [
    descriptor('list', []),
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
    descriptor('taskExecute', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: strict('sessionId', sessionIdSchema) },
    ]),
    descriptor('taskReset', [
      { name: 'id', wire: 'id', source: 'json', codec: strict('NoteId', idSchema) },
    ]),
  ],
}

/* ---------- 类型增广：ctx.remote.notes 有类型 ---------- */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'notes/list': () => Promise<RemoteResult<readonly NoteRecord[]>>
    'notes/create': (input: NoteCreateInput) => Promise<RemoteResult<NoteRecord>>
    'notes/update': (id: NoteId, patch: NoteUpdateInput) => Promise<RemoteResult<NoteRecord | undefined>>
    'notes/setPinned': (id: NoteId, pinned: boolean) => Promise<RemoteResult<NoteRecord | undefined>>
    'notes/delete': (id: NoteId) => Promise<RemoteResult<boolean>>
    'notes/taskExecute': (id: NoteId, sessionId: string) => Promise<RemoteResult<TaskExecuteResult>>
    'notes/taskReset': (id: NoteId) => Promise<RemoteResult<TaskResetResult>>
  }
  interface TypertRemoteNamespaceMap {
    notes: TypertRemoteNamespace<'notes'>
  }
}

/** 供 UI 使用的窄接口（与增广的 ctx.remote.notes 形状一致）。 */
export interface NotesRemote {
  list(): Promise<RemoteResult<readonly NoteRecord[]>>
  create(input: NoteCreateInput): Promise<RemoteResult<NoteRecord>>
  update(id: NoteId, patch: NoteUpdateInput): Promise<RemoteResult<NoteRecord | undefined>>
  setPinned(id: NoteId, pinned: boolean): Promise<RemoteResult<NoteRecord | undefined>>
  delete(id: NoteId): Promise<RemoteResult<boolean>>
  taskExecute(id: NoteId, sessionId: string): Promise<RemoteResult<TaskExecuteResult>>
  taskReset(id: NoteId): Promise<RemoteResult<TaskResetResult>>
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
