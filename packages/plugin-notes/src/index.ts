/**
 * @forge-studio/dsh-plugin-notes —— host 入口。
 * 打开 notes 域（storage-domain）→ 提供 ctx.notes 服务 → 注册工具 / 命令 / 设置。
 * 会话事件 note/listed 由工具与命令在每次变更后写入（见 session-events.ts）。
 *
 * apply 返回 ctx.inject 的 fiber（PromiseLike）：loader 会 await 整个异步链，
 * 保证域打开、服务注册、工具/命令/设置挂载全部完成之后条目才算激活。
 */

import { Context } from '@deepseek-ai/cordis'
import { notesDomain } from './domain.ts'
import { NotesService } from './service.ts'
import { defineNoteTools } from './tools.ts'
import { defineNoteCommand } from './commands.ts'
import { installNotesSettings } from './settings.ts'
import './events.ts'

export const name = '@forge-studio/dsh-plugin-notes'
export const inject = ['storageDomain']

export function apply(ctx: Context) {
  return ctx.inject(['storageDomain'], async (ctx) => {
    const domain = await ctx.storageDomain.open(notesDomain)
    try {
      // 域由本 fiber 负责 close。
      ctx.effect(() => () => { void domain.close() })
      ctx.plugin(NotesService, { domain })
      // 工具：依赖 notes 服务 + tools 注册表。
      const tools = ctx.inject(['notes', 'tools'], (ctx) => {
        for (const tool of defineNoteTools(ctx)) ctx.tools.register(tool)
      })
      // /note 命令：依赖 notes 服务 + commands 注册表。
      const commands = ctx.inject(['notes', 'commands'], (ctx) => {
        ctx.commands.register(defineNoteCommand(ctx))
      })
      // 设置命名空间。
      installNotesSettings(ctx)
      // 等子 fiber 全部落定，条目才算激活（避免 loader 竞态）。
      await Promise.all([tools, commands])
    } catch (error) {
      void domain.close()
      throw error
    }
  })
}
