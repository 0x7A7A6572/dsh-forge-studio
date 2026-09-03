/**
 * @forge-studio/dsh-plugin-notes —— host 入口。
 * 打开 notes 域（storage-domain）→ 提供 ctx.notes 服务（client UI 经 Typert
 * remote 直连）→ 注册设置命名空间。
 *
 * 便签是独立 UI 形态（侧栏入口 + 便签板浮层），不挂会话/命令行/agent 工具；
 * host 只作为 UI 的数据后端与设置源。
 *
 * apply 返回 ctx.inject 的 fiber（PromiseLike）：loader 会 await 整个异步链，
 * 保证域打开、服务注册、设置挂载全部完成之后条目才算激活。
 */

import { Context } from '@deepseek-ai/cordis'
import { notesDomain } from './domain.ts'
import { NotesService } from './service.ts'
import { installNotesSettings } from './settings.ts'

export const name = '@forge-studio/dsh-plugin-notes'
export const inject = ['storageDomain']

export function apply(ctx: Context) {
  return ctx.inject(['storageDomain'], async (ctx) => {
    const domain = await ctx.storageDomain.open(notesDomain)
    try {
      // 域由本 fiber 负责 close。
      ctx.effect(() => () => { void domain.close() })
      ctx.plugin(NotesService, { domain })
      // 设置命名空间（client 设置卡片读写）。
      installNotesSettings(ctx)
    } catch (error) {
      void domain.close()
      throw error
    }
  })
}
