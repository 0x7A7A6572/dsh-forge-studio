/**
 * plugin-notes × agent harness 桥（host 侧）—— 便签 CRUD 工具注册 + 权限策略。
 *
 * 把 ctx.notes（NotesService，同 ctx 直调，不走 Typert wire）暴露成 agent 工具：
 * - 读工具（notes_list / notes_get）：放行；
 * - 写工具（notes_create / notes_update / notes_set_pinned / notes_delete）：
 *   宿主装有 approval seam（ctx.get('approval')）时在 tools/pre-execute 返回
 *   { kind: 'ask' }，由 user-approval 弹确认后执行（未批准即 deny，fail-closed）；
 *   宿主无 approval seam 时放行（与 tool-fs「无 policy 即 unconditional」同款）；
 * - guard（单调拒绝，任何宿主都生效）：agent 永远不能删除 origin='user' 的便签
 *   —— 即便 pre-execute 已 ask/放行，guard 层仍拒绝，保护用户手写内容。
 *
 * 工具以 tools 服务判存后条件挂载：plugin-notes 独立 UI 形态在无 agent 装配的
 * 宿主照常工作（不注册工具），有 tools 的宿主自动获得 agent 联动。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '../service.ts'
import type { NoteId, NoteRecord, TaskStatus } from '../types.ts'
import { NOTE_COLORS } from '../types.ts'

/** 工具名前缀：注册/guard/ask 全部按此前缀路由，避免误伤宿主其他工具。 */
export const NOTES_TOOL_PREFIX = 'notes_'

const TOOL_LIST = `${NOTES_TOOL_PREFIX}list`
const TOOL_GET = `${NOTES_TOOL_PREFIX}get`
const TOOL_CREATE = `${NOTES_TOOL_PREFIX}create`
const TOOL_UPDATE = `${NOTES_TOOL_PREFIX}update`
const TOOL_SET_PINNED = `${NOTES_TOOL_PREFIX}set_pinned`
const TOOL_DELETE = `${NOTES_TOOL_PREFIX}delete`

/** 任务工具：独立于写工具 ask 集合（点击执行即一次性授权，guard 兜底）。 */
const TOOL_TASK_SET_STATUS = `${NOTES_TOOL_PREFIX}task_set_status`
const TOOL_TASK_REPORT = `${NOTES_TOOL_PREFIX}task_report`

/** 写工具集合（决定 ask 范围）。 */
const WRITE_TOOLS = new Set<string>([TOOL_CREATE, TOOL_UPDATE, TOOL_SET_PINNED, TOOL_DELETE])

/** 本插件工具名判定。 */
export function isNotesTool(name: string): boolean {
  return name.startsWith(NOTES_TOOL_PREFIX)
}

/** 写工具判定。 */
export function isNotesWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name)
}

/** 任务工具判定（notes_task_*）。 */
export function isNotesTaskTool(name: string): boolean {
  return name === TOOL_TASK_SET_STATUS || name === TOOL_TASK_REPORT
}

/* ---------- 渲染（model-facing 文本） ---------- */

/**
 * 任务状态枚举（与 types.ts 的 TaskStatus 保持同步）。agent 工具层写死以避免对
 * domain.ts（host 域，依赖 storage-domain/zod）的运行时 import；改动 TaskStatus
 * 时须同步此处。
 */
const TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed'] as const

/**
 * 定时形态枚举（与 types.ts 的 SCHEDULE_MODES 保持同步）。同样是写死字面量以避免
 * 对 types.ts 之外的运行时 import；改动 types.ts 时须同步此处。
 */
const SCHEDULE_MODES = ['once', 'interval', 'daily', 'weekly', 'monthly'] as const

function noteText(note: NoteRecord): string {
  const flags = [
    note.pinned ? 'pinned' : '',
    note.archived ? 'archived' : '',
    note.origin === 'agent' ? 'agent-created' : 'user-created',
  ].filter(Boolean).join(', ')
  const meta = flags.length > 0 ? `\n(${flags})` : ''
  // lane 透出：任务便签标注状态与 run（startedAt 必带，summary 有则给）。
  const lane = note.lane
  const laneLine = lane
    ? `\n(task: ${lane.status}` +
      (lane.run ? ` · run@${lane.run.startedAt}` : '') +
      (lane.run?.summary ? ` · ${lane.run.summary}` : '') +
      ')'
    : ''
  return `${note.title || '(untitled)'}\n${note.text || ''}${meta}${laneLine}`
}

/** 读工具输出里 lane 字段的 schema 形状（与 domain.ts lane 校验一致）。 */
const LANE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: [...TASK_STATUSES] },
    run: {
      type: 'object',
      additionalProperties: false,
      properties: {
        startedAt: { type: 'number', required: true },
        finishedAt: { type: 'number' },
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        // 发起方：'schedule' = 定时自动派发；旧记录无该字段。
        by: { type: 'string', enum: ['user', 'schedule'] },
      },
    },
  },
} as const

/** 读工具输出里 schedule 字段的 schema 形状（与 domain.ts 的 schedule 校验一致）。 */
const SCHEDULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean', required: true },
    mode: { type: 'string', required: true, enum: [...SCHEDULE_MODES] },
    at: { type: 'number' },
    everyMin: { type: 'number' },
    time: { type: 'string' },
    weekdays: { type: 'array', items: { type: 'number' } },
    monthDay: { type: 'number' },
    // host 调度器自有字段：nextAt 权威下次时刻；lastFiredAt/lastResult 最近派发记录；
    // failureStreak/runCount 是错误边界计数（连续失败熔断 / 累计派发次数）。
    nextAt: { type: 'number', required: true },
    lastFiredAt: { type: 'number' },
    lastResult: { type: 'string' },
    failureStreak: { type: 'number' },
    runCount: { type: 'number' },
  },
} as const

/**
 * 便签输出的公共 schema：读/写工具的输出值都是**整张** NoteRecord（含 lane、schedule、workspace）。
 *
 * 曾经各工具内联各自的形状，于是 `lane` / `workspace` / `schedule` 这种后加字段漏在某处时，
 * harness 的 additionalProperties:false 校验会把整次调用判为非法输出（现象：有工作区的
 * 便签读不出来、任务便签的 lane 传不回去、带日程的便签连 notes_list 都整条失败）。
 * 新增字段只改这一份。
 */
const NOTE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    text: { type: 'string', required: true },
    pinned: { type: 'boolean', required: true },
    archived: { type: 'boolean', required: true },
    color: { type: 'string', required: true, enum: [...NOTE_COLORS] },
    origin: { type: 'string', required: true, enum: ['user', 'agent'] },
    createdAt: { type: 'number', required: true },
    updatedAt: { type: 'number', required: true },
    lane: LANE_SCHEMA,
    /** 任务定时日程（host 调度器写 nextAt/lastFiredAt/lastResult；缺省 = 不定时）。 */
    schedule: SCHEDULE_SCHEMA,
    /** 任务执行工作区（绝对目录路径）；缺省 = 执行时回退默认工作区。 */
    workspace: { type: 'string' },
  },
} as const

/* ---------- guard（单调拒绝，同步） ---------- */

/**
 * notes_delete 的 guard 判定：目标是 origin='user' 的便签 → 拒绝（agent 永远
 * 不能删除用户手写便签）。同步执行，从 ctx.notes 同步读内存态。
 * @returns 拒绝原因；不拒绝返回 undefined。
 */
export function notesDeleteGuard(ctx: Context, exec: ToolExecution): string | undefined {
  if (exec.name !== TOOL_DELETE) return undefined
  const args = exec.arguments as { note_id?: unknown } | undefined
  const id = args?.note_id
  if (typeof id !== 'string') return undefined
  const note = ctx.notes.list().find(n => n.id === id)
  if (note?.origin === 'user') {
    return `cannot delete note ${id}: it was written by the user (origin=user). Agents may only delete notes they created themselves (origin=agent).`
  }
  return undefined
}

/**
 * notes_task_* 的 guard 判定（同步、单调，任何宿主生效）。拒绝条件（任一）：
 * 目标便签不存在；便签无 lane（非任务）；无 active lease；lease.sessionId 与
 * 调用会话身份不符。会话身份取自 exec.agent.id（SessionId，见 dsh-tools
 * ToolExecution.agent —— 有稳定身份字段，故按 sessionId 匹配；agent 缺省时
 * 视为身份不可核验 → 拒绝，fail-closed）。
 * @returns 中文拒绝原因；不拒绝返回 undefined。
 */
export function notesTaskGuard(ctx: Context, exec: ToolExecution): string | undefined {
  if (!isNotesTaskTool(exec.name)) return undefined
  const args = exec.arguments as { note_id?: unknown } | undefined
  const id = args?.note_id
  if (typeof id !== 'string') return undefined
  const note = ctx.notes.list().find((n) => n.id === id)
  if (note === undefined) return `任务便签 ${id} 不存在`
  if (note.lane === undefined) return `便签 ${id} 不是任务（无 lane），notes_task_* 只能操作任务便签`
  const lease = ctx.notes.getTaskLease(id as NoteId)
  if (lease === undefined) {
    return `便签 ${id} 无有效执行租约：任务可能已被手动接管或已收尾，如需继续请重新执行`
  }
  const caller = exec.agent?.id
  if (caller !== lease.sessionId) {
    return `便签 ${id} 的执行租约属于会话 ${lease.sessionId}，与当前调用会话不符`
  }
  return undefined
}

/* ---------- 工具注册 ---------- */

/**
 * 注册便签工具 + guard + pre-execute ask 策略。
 * @param ctx - 已挂载 ctx.notes 的宿主 ctx（NotesService 已 ctx.plugin）。
 */
export function installNotesTools(ctx: Context): void {
  const notes = ctx.notes

  /* ----- 读工具 ----- */

  ctx.tools.register(defineTool({
    name: TOOL_LIST,
    description: 'List all sticky notes (id, title, color, pinned/archived flags). Use notes_get to read the full text of one note.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          notes: {
            type: 'array',
            required: true,
            items: NOTE_OUTPUT_SCHEMA,
          },
        },
      },
      render: (_args, value) => {
        const items = (value as { notes: NoteRecord[] }).notes
        if (items.length === 0) return [{ type: 'text', text: '(no notes)' }]
        return [{
          type: 'text',
          text: items.map(n =>
            `- ${n.id} · ${n.title || '(untitled)'}${n.archived ? ' · archived' : ''}${n.pinned ? ' · pinned' : ''} · ${n.color}`,
          ).join('\n'),
        }]
      },
    },
    async execute(_args, _exec) {
      return { notes: notes.list() }
    },
  }))

  ctx.tools.register(defineTool({
    name: TOOL_GET,
    description: 'Read one sticky note by id: full title and text plus its flags. The id comes from notes_list.',
    parameters: {
      note_id: { type: 'string', required: true, description: 'The note id from notes_list.' },
    },
    output: {
      schema: NOTE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: noteText(value as NoteRecord) }],
    },
    async execute(args, _exec) {
      const id = args.note_id as NoteId
      const note = notes.list().find(n => n.id === id)
      if (note === undefined) throw new Error(`note ${id} not found`)
      return note
    },
  }))

  /* ----- 写工具（ask / guard 由下方策略处理） ----- */

  ctx.tools.register(defineTool({
    name: TOOL_CREATE,
    description: 'Create a sticky note. Notes created through this tool are marked origin=agent (the user\'s own notes are origin=user).',
    parameters: {
      title: { type: 'string', description: 'Note title. Defaults to 新便签 when omitted.' },
      text: { type: 'string', required: true, description: 'Note body (plain text or markdown).' },
      color: { type: 'string', enum: [...NOTE_COLORS], description: 'Sticky-note color. Defaults to yellow when omitted.' },
    },
    output: {
      schema: NOTE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: noteText(value as NoteRecord) }],
    },
    async execute(args, _exec) {
      return notes.create({
        ...args.title !== undefined ? { title: args.title } : {},
        text: args.text,
        ...args.color !== undefined ? { color: args.color as NoteRecord['color'] } : {},
        // agent 工具层创建 → 来源 'agent'（UI/用户创建才落 'user'）。
        origin: 'agent',
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: TOOL_UPDATE,
    description: 'Update an existing sticky note (title / text / color / pinned / archived). Only fields provided are changed; origin can never be changed.',
    parameters: {
      note_id: { type: 'string', required: true, description: 'The note id from notes_list.' },
      title: { type: 'string', description: 'New title.' },
      text: { type: 'string', description: 'New body.' },
      color: { type: 'string', enum: [...NOTE_COLORS], description: 'New color.' },
      pinned: { type: 'boolean', description: 'Pin or unpin.' },
      archived: { type: 'boolean', description: 'Archive or restore.' },
    },
    output: {
      schema: NOTE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: noteText(value as NoteRecord) }],
    },
    async execute(args, _exec) {
      const id = args.note_id as NoteId
      const note = await notes.update(id, {
        ...args.title !== undefined ? { title: args.title } : {},
        ...args.text !== undefined ? { text: args.text } : {},
        ...args.color !== undefined ? { color: args.color as NoteRecord['color'] } : {},
        ...args.pinned !== undefined ? { pinned: args.pinned } : {},
        ...args.archived !== undefined ? { archived: args.archived } : {},
      })
      if (note === undefined) throw new Error(`note ${id} not found`)
      return note
    },
  }))

  ctx.tools.register(defineTool({
    name: TOOL_SET_PINNED,
    description: 'Pin or unpin one sticky note (equivalent to notes_update with only the pinned field).',
    parameters: {
      note_id: { type: 'string', required: true, description: 'The note id from notes_list.' },
      pinned: { type: 'boolean', required: true, description: 'true pins, false unpins.' },
    },
    output: {
      schema: NOTE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: noteText(value as NoteRecord) }],
    },
    async execute(args, _exec) {
      const id = args.note_id as NoteId
      const note = await notes.setPinned(id, args.pinned)
      if (note === undefined) throw new Error(`note ${id} not found`)
      return note
    },
  }))

  ctx.tools.register(defineTool({
    name: TOOL_DELETE,
    description: 'Delete one sticky note. Only notes the agent created itself (origin=agent) can be deleted; deleting a user-written note (origin=user) is rejected by policy.',
    parameters: {
      note_id: { type: 'string', required: true, description: 'The note id from notes_list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'boolean', required: true },
          id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.deleted ? `note ${value.id} deleted` : `note ${value.id} not found`,
      }],
    },
    async execute(args, _exec) {
      const id = args.note_id as NoteId
      const deleted = await notes.delete(id)
      return { deleted, id }
    },
  }))

  /* ----- 任务工具（窄权限，无 ask，lease guard 兜底） ----- */

  ctx.tools.register(defineTool({
    name: TOOL_TASK_SET_STATUS,
    description:
      'Set a task note\'s lane status to "running" (the ONLY value this tool accepts). ' +
      'Protocol: at the start of a run, assert "running" before doing the work — this is optional ' +
      'since the host already grants "running" at dispatch and re-asserting it is a harmless no-op. ' +
      'To end the run, do NOT use this tool: call notes_task_report instead (it writes the result ' +
      'summary and settles the run to done/failed automatically). Only works while this note holds ' +
      'an active execution lease for the calling session. ' +
      // 执行的协议写在工具说明里而不是投递消息里：投递消息是**用户消息**，会逐字出现在
      // 会话记录中（见 task-dispatch.ts buildTaskDispatchMessage —— 首行只有「⇲ 标题」）。
      'A dispatched task message starts with a ⇲ line carrying the note title (the formal ' +
      'instruction sits at its end): read the note in full with ' +
      'notes_get first (including lane.run.summary from a previous run), then do the work. ' +
      'Only the lane status/result may be touched — never rewrite the note body, title, or color.',
    parameters: {
      note_id: { type: 'string', required: true, description: 'The task note id from notes_list.' },
      status: { type: 'string', required: true, enum: [...TASK_STATUSES], description: 'Must be "running" (the only accepted value); done/failed go through notes_task_report.' },
    },
    output: {
      schema: NOTE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: noteText(value as NoteRecord) }],
    },
    async execute(args, _exec) {
      const id = args.note_id as NoteId
      const status = args.status as TaskStatus
      if (status !== 'running') {
        throw new Error('任务状态变更请用执行中的 report 结束：set_status 仅允许置为 running')
      }
      const note = await notes.setTaskStatus(id, status)
      if (note === undefined) throw new Error(`task note ${id} not found or has no lane`)
      return note
    },
  }))

  ctx.tools.register(defineTool({
    name: TOOL_TASK_REPORT,
    description:
      'End a task run and record its result. Writes the run summary, sets status to "done" ' +
      '(ok=true) or "failed" (ok=false), and releases the execution lease (after which another ' +
      'notes_task_* call is rejected until the task is executed again). Protocol: read the task ' +
      'note in full with notes_get first, work on it, then report ok=true + summary on success or ' +
      'ok=false + reason on failure. Only the lane status/result may be touched — never rewrite ' +
      'the note body, title, or color.',
    parameters: {
      note_id: { type: 'string', required: true, description: 'The task note id from notes_list.' },
      ok: { type: 'boolean', required: true, description: 'true if the task succeeded, false if it failed.' },
      summary: { type: 'string', required: true, description: 'Short markdown summary of the result, or the failure reason.' },
    },
    output: {
      schema: NOTE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: noteText(value as NoteRecord) }],
    },
    async execute(args, _exec) {
      const id = args.note_id as NoteId
      const note = await notes.settleTaskRun(id, args.ok, args.summary)
      if (note === undefined) throw new Error(`task note ${id} not found or has no lane`)
      return note
    },
  }))

  // 单调 guard：任何调用（含被 pre-execute 放行的）都不能删 user 便签。
  ctx.tools.guard((exec) => notesDeleteGuard(ctx, exec))

  // 单调 guard：notes_task_* 必须持有匹配 lease（无 lane / 无 lease / 会话不符 → 拒绝）。
  ctx.tools.guard((exec) => notesTaskGuard(ctx, exec))

  // pre-execute ask：宿主有 approval seam 时，写工具先弹确认；没有则放行
  // （无 policy 即 unconditional，guard 仍兜底 user 便签）。任务工具不放 ask。
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!isNotesTool(exec.name)) return next()
    if (isNotesTaskTool(exec.name)) return next()
    if (!WRITE_TOOLS.has(exec.name)) return next()
    if (ctx.get('approval') === undefined) return next()
    return { kind: 'ask', reason: `The agent wants to ${describeAction(exec.name)} a sticky note.` }
  })
}

/** ask reason 用的人话动作描述。 */
function describeAction(tool: string): string {
  switch (tool) {
    case TOOL_CREATE: return 'create'
    case TOOL_UPDATE: return 'update'
    case TOOL_SET_PINNED: return 'pin/unpin'
    case TOOL_DELETE: return 'delete'
    default: return 'write'
  }
}
