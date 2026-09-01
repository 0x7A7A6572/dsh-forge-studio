/**
 * /note 命令 —— Forge Studio F1 的人类快捷入口：不经过模型，直接操作便签并
 * 把完整列表快照写入会话（note/listed），UI 节点实时折叠。
 *
 * 语法（rawInput，大小写不敏感）：
 *   /note                     —— 列出全部便签
 *   /note add <标题>[: 正文]  —— 创建（正文可选，分隔符为 `:`/`：`/换行）
 *   /note rm <id>             —— 删除
 *   /note pin <id>            —— 置顶
 *   /note unpin <id>          —— 取消置顶
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NoteId } from './types.ts'
import { appendNoteListed } from './session-events.ts'

type Subcommand = 'list' | 'add' | 'rm' | 'pin' | 'unpin'

function parse(raw: string): { sub: Subcommand; arg: string } {
  const line = raw.trim()
  const [head, ...rest] = line.split(/\s+/)
  const sub = (head || 'list').toLowerCase() as Subcommand
  return { sub, arg: rest.join(' ').trim() }
}

export function defineNoteCommand(ctx: Context): CommandDefinition {
  return {
    name: 'note',
    description: '便签：note add <标题>[: 正文] / note rm <id> / note pin|unpin <id> / note list',
    input: { hint: 'add <标题>[: 正文] | list | rm <id> | pin|unpin <id>' },
    async handler(invocation: CommandInvocation): Promise<CommandResult> {
      const session = invocation.agent.session
      const { sub, arg } = parse(invocation.rawInput)

      switch (sub) {
        case 'list': {
          const notes = ctx.notes.list()
          const body = notes.length
            ? notes.map((n) => `- [${n.pinned ? '📌' : '  '}] ${n.id} ${n.title}（${n.text.slice(0, 40)}）`).join('\n')
            : '（暂无便签）'
          return { kind: 'success', text: `共 ${notes.length} 条便签：\n${body}` }
        }
        case 'add': {
          if (!arg) return { kind: 'error', text: '用法：/note add <标题>[: 正文]' }
          const sep = arg.search(/[:：\n]/)
          const title = (sep >= 0 ? arg.slice(0, sep) : arg).trim()
          const text = (sep >= 0 ? arg.slice(sep + 1) : '').trim()
          const note = await ctx.notes.create({ title, text })
          appendNoteListed(session, ctx.notes.list())
          return { kind: 'success', text: `已创建便签「${note.title}」（id=${note.id}）` }
        }
        case 'rm': {
          if (!arg) return { kind: 'error', text: '用法：/note rm <id>' }
          const ok = await ctx.notes.remove(brandString<NoteId>(arg))
          if (!ok) return { kind: 'error', text: `便签不存在: ${arg}` }
          appendNoteListed(session, ctx.notes.list())
          return { kind: 'success', text: `已删除便签 ${arg}` }
        }
        case 'pin':
        case 'unpin': {
          if (!arg) return { kind: 'error', text: `用法：/note ${sub} <id>` }
          const note = await ctx.notes.setPinned(brandString<NoteId>(arg), sub === 'pin')
          if (!note) return { kind: 'error', text: `便签不存在: ${arg}` }
          appendNoteListed(session, ctx.notes.list())
          return { kind: 'success', text: `已${sub === 'pin' ? '置顶' : '取消置顶'}便签 ${arg}` }
        }
        default:
          return { kind: 'error', text: `未知子命令：${sub}` }
      }
    },
  }
}
