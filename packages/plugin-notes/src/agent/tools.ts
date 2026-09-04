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
import type { NoteId, NoteRecord } from '../types.ts'
import { NOTE_COLORS } from '../types.ts'

/** 工具名前缀：注册/guard/ask 全部按此前缀路由，避免误伤宿主其他工具。 */
export const NOTES_TOOL_PREFIX = 'notes_'

const TOOL_LIST = `${NOTES_TOOL_PREFIX}list`
const TOOL_GET = `${NOTES_TOOL_PREFIX}get`
const TOOL_CREATE = `${NOTES_TOOL_PREFIX}create`
const TOOL_UPDATE = `${NOTES_TOOL_PREFIX}update`
const TOOL_SET_PINNED = `${NOTES_TOOL_PREFIX}set_pinned`
const TOOL_DELETE = `${NOTES_TOOL_PREFIX}delete`

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

/* ---------- 渲染（model-facing 文本） ---------- */

/**
 * 任务状态枚举（与 types.ts 的 TaskStatus 保持同步）。agent 工具层写死以避免对
 * domain.ts（host 域，依赖 storage-domain/zod）的运行时 import；改动 TaskStatus
 * 时须同步此处。
 */
const TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed'] as const

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
      },
    },
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
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                pinned: { type: 'boolean', required: true },
                archived: { type: 'boolean', required: true },
                color: { type: 'string', required: true, enum: [...NOTE_COLORS] },
                origin: { type: 'string', required: true, enum: ['user', 'agent'] },
                updatedAt: { type: 'number', required: true },
                lane: LANE_SCHEMA,
              },
            },
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
      schema: {
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
        },
      },
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
      schema: {
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
        },
      },
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
      schema: {
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
        },
      },
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
      schema: {
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
        },
      },
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

  // 单调 guard：任何调用（含被 pre-execute 放行的）都不能删 user 便签。
  ctx.tools.guard((exec) => notesDeleteGuard(ctx, exec))

  // pre-execute ask：宿主有 approval seam 时，写工具先弹确认；没有则放行
  // （无 policy 即 unconditional，guard 仍兜底 user 便签）。
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!isNotesTool(exec.name)) return next()
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
