/**
 * notes 工具集：notes_create / notes_list / notes_update / notes_delete。
 * 每次变更后把完整列表快照写进调用者 agent 的会话（appendNoteListed），
 * “模型可见即已记录”：工具返回的文本进模型上下文，note/listed 事件驱动 UI。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { NoteId } from './types.ts'
import { appendNoteListed } from './session-events.ts'

function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** 变更后把快照追加进调用会话（agent 缺省时静默跳过）。 */
function emitListed(ctx: Context, exec: ToolRunContext): void {
  const session = exec.agent?.session
  if (!session) return
  appendNoteListed(session, ctx.notes.list())
}

export function defineNoteTools(ctx: Context): ToolDefinition[] {
  return [
    defineTool({
      name: 'notes_create',
      description: '创建一条便签；title 缺省时使用默认标题，text 为便签正文',
      parameters: {
        title: { type: 'string', description: '便签标题' },
        text: { type: 'string', required: true, description: '便签正文（纯文本或 markdown）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            text: { type: 'string' },
            pinned: { type: 'boolean' },
            createdAt: { type: 'number' },
            updatedAt: { type: 'number' },
          },
        },
        render: (_args, value) => text(`已创建便签「${value.title}」（id=${value.id}）`),
      },
      async execute(args, exec) {
        const note = await ctx.notes.create({ title: args.title, text: args.text })
        emitListed(ctx, exec)
        return note
      },
    }),

    defineTool({
      name: 'notes_list',
      description: '列出当前会话可用的所有便签（含置顶标记）',
      parameters: {},
      output: {
        schema: { type: 'array', items: { type: 'json' } },
        render: (_args, value) => text(`共 ${(value as readonly unknown[]).length} 条便签`),
      },
      async execute() {
        // 输出 schema 声明为 JSON 数组；记录对象是 lossless-JSON，此处是纯形状收窄。
        return ctx.notes.list() as unknown as JsonValue[]
      },
    }),

    defineTool({
      name: 'notes_update',
      description: '更新一条便签的标题/正文/置顶状态（至少提供一项）',
      parameters: {
        id: { type: 'string', required: true, description: '便签 id' },
        title: { type: 'string', description: '新标题' },
        text: { type: 'string', description: '新正文' },
        pinned: { type: 'boolean', description: '是否置顶' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => text(`已更新便签「${value.title ?? value.id}」`),
      },
      async execute(args, exec) {
        if (args.title === undefined && args.text === undefined && args.pinned === undefined) {
          throw new Error('notes_update 至少需要 title/text/pinned 之一')
        }
        const note = await ctx.notes.update(args.id as NoteId, {
          title: args.title,
          text: args.text,
          pinned: args.pinned,
        })
        if (!note) throw new Error(`便签不存在: ${args.id}`)
        emitListed(ctx, exec)
        return note as unknown as Record<string, JsonValue>
      },
    }),

    defineTool({
      name: 'notes_delete',
      description: '删除一条便签',
      parameters: {
        id: { type: 'string', required: true, description: '便签 id' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } } },
        render: (_args, value) => text(`已删除便签 ${value.id}`),
      },
      async execute(args, exec) {
        const ok = await ctx.notes.remove(args.id as NoteId)
        if (!ok) throw new Error(`便签不存在: ${args.id}`)
        emitListed(ctx, exec)
        return { id: args.id }
      },
    }),
  ]
}
