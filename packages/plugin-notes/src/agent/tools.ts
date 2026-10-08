/**
 * 便签 agent 工具：读工具放行，碰 origin='user' 便签的写工具由工具自身走
 * user-questions 问一次同意（不经 approval seam，与会话审批策略无关）；
 * 宿主没有该 seam 时 guard 兜底禁删。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '../service.ts'
import type { NoteId, NoteRecord, TaskStatus } from '../types.ts'
import { NOTE_COLORS } from '../types.ts'

export const NOTES_TOOL_PREFIX = 'notes_'

const TOOL_LIST = `${NOTES_TOOL_PREFIX}list`
const TOOL_GET = `${NOTES_TOOL_PREFIX}get`
const TOOL_CREATE = `${NOTES_TOOL_PREFIX}create`
const TOOL_UPDATE = `${NOTES_TOOL_PREFIX}update`
const TOOL_SET_PINNED = `${NOTES_TOOL_PREFIX}set_pinned`
const TOOL_DELETE = `${NOTES_TOOL_PREFIX}delete`

const TOOL_TASK_SET_STATUS = `${NOTES_TOOL_PREFIX}task_set_status`
const TOOL_TASK_REPORT = `${NOTES_TOOL_PREFIX}task_report`

const WRITE_TOOLS = new Set<string>([TOOL_CREATE, TOOL_UPDATE, TOOL_SET_PINNED, TOOL_DELETE])

export function isNotesTool(name: string): boolean {
  return name.startsWith(NOTES_TOOL_PREFIX)
}

export function isNotesWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name)
}

function noteLabel(note: NoteRecord): string {
  return note.title === '' ? note.id : note.title
}

function noteById(ctx: Context, id: unknown): NoteRecord | undefined {
  if (typeof id !== 'string') return undefined
  return ctx.notes.list().find((n) => n.id === id)
}

/** 只为 Context 声明合并，让 ctx.get('userQuestions') 的类型成立（type-only）。 */
import type {} from '@deepseek-ai/dsh-user-questions'

const CONSENT_ALLOW = '允许一次'
const CONSENT_DENY = '不要'

/**
 * 由工具自身走 user-questions 问一次同意，不经 approval seam，
 * 故与会话审批策略无关；没有该 seam 或未选中「允许一次」一律抛错。
 */
export async function requestNoteConsent(ctx: Context, exec: ToolExecution, action: string): Promise<void> {
  const questions = ctx.get('userQuestions')
  if (questions === undefined) {
    throw new Error(`cannot ${action}: this host has no way to ask you for consent`)
  }
  let answer: Awaited<ReturnType<typeof questions.ask>>
  try {
    answer = await questions.ask({
      questions: [{
        id: 'notes-consent',
        question: `The agent wants to ${action}. Allow?`,
        options: [{ label: CONSENT_ALLOW }, { label: CONSENT_DENY }],
      }],
      ...exec.agent !== undefined ? { agent: exec.agent } : {},
      ...exec.signal !== undefined ? { signal: exec.signal } : {},
    })
  } catch (error) {
    throw new Error(`cannot ${action}: the confirmation could not be shown`, { cause: error })
  }
  const selected = answer.answers.find(a => a.id === 'notes-consent')?.selected ?? []
  if (selected.includes(CONSENT_ALLOW)) return
  throw new Error(`cannot ${action}: not allowed`)
}

export function isNotesTaskTool(name: string): boolean {
  return name === TOOL_TASK_SET_STATUS || name === TOOL_TASK_REPORT
}

/* ---------- 渲染（model-facing 文本） ---------- */

/** 与 types.ts 的 TaskStatus 同步（此处写死字面量，避免运行时 import domain.ts）。 */
const TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed'] as const

/** 与 types.ts 的 SCHEDULE_MODES 同步（同样写死字面量，避免运行时 import）。 */
const SCHEDULE_MODES = ['once', 'interval', 'daily', 'weekly', 'monthly'] as const

function noteText(note: NoteRecord): string {
  const flags = [
    note.pinned ? 'pinned' : '',
    note.archived ? 'archived' : '',
    note.origin === 'agent' ? 'agent-created' : 'user-created',
  ].filter(Boolean).join(', ')
  const meta = flags.length > 0 ? `\n(${flags})` : ''
  const lane = note.lane
  const laneLine = lane
    ? `\n(task: ${lane.status}` +
      (lane.run ? ` · run@${lane.run.startedAt}` : '') +
      (lane.run?.summary ? ` · ${lane.run.summary}` : '') +
      ')'
    : ''
  return `${note.title || '(untitled)'}\n${note.text || ''}${meta}${laneLine}`
}

/** 与 domain.ts 的 lane 校验一致。 */
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
        by: { type: 'string', enum: ['user', 'schedule'] },
      },
    },
    // 缺省 = 宿主默认预设 / 默认模型。
    agentPreset: { type: 'string' },
    model: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
        reasoningEffort: { type: 'string' },
      },
    },
  },
} as const

/** 与 domain.ts 的 schedule 校验一致。 */
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
    // nextAt 是权威下次时刻；failureStreak 达上限即熔断停用。
    nextAt: { type: 'number', required: true },
    lastFiredAt: { type: 'number' },
    lastResult: { type: 'string' },
    failureStreak: { type: 'number' },
    runCount: { type: 'number' },
  },
} as const

/**
 * 读/写工具的输出值都是整张 NoteRecord；输出校验是 additionalProperties:false，
 * 漏一个字段整次调用即判非法 —— 新增字段只改这一份。
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
    /** 缺省 = 不定时。 */
    schedule: SCHEDULE_SCHEMA,
    /** 绝对目录路径；缺省 = 执行被拒。 */
    workspace: { type: 'string' },
  },
} as const

/* ---------- guard（单调拒绝，同步） ---------- */

/**
 * 仅兜底「宿主没装 user-questions seam」这一种情形：此时没有渠道征求同意，
 * 故拒绝删除 origin='user' 的便签。常规授权走 {@link requestNoteConsent}。
 */
export function notesDeleteGuard(ctx: Context, exec: ToolExecution): string | undefined {
  if (exec.name !== TOOL_DELETE) return undefined
  if (ctx.get('userQuestions') !== undefined) return undefined
  const id = (exec.arguments as { note_id?: unknown } | undefined)?.note_id
  if (typeof id !== 'string') return undefined
  if (ctx.notes.list().find(n => n.id === id)?.origin !== 'user') return undefined
  return `cannot delete note ${id}: it was written by the user (origin=user). Agents may only delete notes they created themselves (origin=agent).`
}

/**
 * 租约归属按 exec.agent.id 与会话比对（fail-closed：agent 缺省即拒）。
 * 便签不存在 / 无 lane / 无租约 / 会话不符都拒绝。
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

  /* ----- 写工具 ----- */

  ctx.tools.register(defineTool({
    name: TOOL_CREATE,
    description:
      'Create a sticky note. Notes created through this tool are marked origin=agent ' +
      '(the user\'s own notes are origin=user). Pass laneStatus to create it as a task note ' +
      'sitting in that lane (task notes are the ones that can be dispatched to an agent); ' +
      'omit it for a plain note.',
    parameters: {
      title: { type: 'string', description: 'Note title. Defaults to 新便签 when omitted.' },
      text: { type: 'string', required: true, description: 'Note body (plain text or markdown).' },
      color: { type: 'string', enum: [...NOTE_COLORS], description: 'Sticky-note color. Defaults to yellow when omitted.' },
      laneStatus: { type: 'string', enum: [...TASK_STATUSES], description: 'Create it as a task note in this lane (Backlog / To do / Running / Done / Failed). Omit for a plain note.' },
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
        ...args.laneStatus !== undefined ? { laneStatus: args.laneStatus as TaskStatus } : {},
        origin: 'agent',
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: TOOL_UPDATE,
    description: 'Update an existing sticky note (title / text / color / pinned / archived). Only fields provided are changed; origin can never be changed. Updating a note the user wrote themselves asks them for confirmation first.',
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
    async execute(args, exec) {
      const id = args.note_id as NoteId
      const target = noteById(ctx, id)
      if (target?.origin === 'user') await requestNoteConsent(ctx, exec, `update your note "${noteLabel(target)}"`)
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
    description: 'Delete one sticky note. Deleting a note the user wrote themselves asks them for confirmation first; without an approval channel only the agent\'s own notes can be deleted.',
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
    async execute(args, exec) {
      const id = args.note_id as NoteId
      const target = noteById(ctx, id)
      if (target?.origin === 'user') await requestNoteConsent(ctx, exec, `delete your note "${noteLabel(target)}"`)
      const deleted = await notes.delete(id)
      return { deleted, id }
    },
  }))

  /* ----- 任务工具 ----- */

  ctx.tools.register(defineTool({
    name: TOOL_TASK_SET_STATUS,
    description:
      'Set a task note\'s lane status to "running" (the ONLY value this tool accepts). ' +
      'Protocol: at the start of a run, assert "running" before doing the work — this is optional ' +
      'since the host already grants "running" at dispatch and re-asserting it is a harmless no-op. ' +
      'To end the run, do NOT use this tool: call notes_task_report instead (it writes the result ' +
      'summary and settles the run to done/failed automatically). Only works while this note holds ' +
      'an active execution lease for the calling session. ' +
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

  ctx.tools.guard((exec) => notesDeleteGuard(ctx, exec))

  ctx.tools.guard((exec) => notesTaskGuard(ctx, exec))

}

