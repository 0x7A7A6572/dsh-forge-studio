/**
 * @forge-studio/dsh-plugin-notes —— host 入口。
 * 打开 notes 域（storage-domain）→ 提供 ctx.notes 服务（client UI 经 Typert
 * remote 直连）→ 注册设置命名空间 → 挂载 agent 桥（便签工具 + 引用引导）。
 *
 * 便签是独立 UI 形态（侧栏入口 + 便签板浮层），同时把 CRUD 暴露成 agent 工具：
 * 宿主装配了 tools/systemPrompt（完整 dsh 装配）时自动注册 notes_* 工具与
 * note:// mention 的系统提示引导；无这些服务的宿主（纯 UI 数据后端）照常
 * 工作，只是不注册工具。
 *
 * 挂载时机（关键）：宿主装配是 service-availability 驱动的（dsh-base 组合注释：
 * 行序不承载加载语义，激活由服务可用性决定）。本插件声明依赖 storageDomain，
 * 可能先于 tools / systemPrompt 服务就绪——因此 agent 桥不能用 apply 时的一次性
 * ctx.get('tools') 判存（服务尚未注册时判存 false 就永久漏挂、无重试）。桥改用
 * ctx.inject 声明依赖：cordis 在服务注册（provide→notify）时唤醒等待中的 fiber，
 * 无论服务先到还是后到都能挂上；宿主从不提供该服务时 fiber 静默挂起、随 ctx
 * 卸载清理，不阻塞核心。
 *
 * apply 返回 ctx.inject 的 fiber（PromiseLike）：loader 会 await 整个异步链，
 * 保证域打开、服务注册、设置挂载全部完成之后条目才算激活。
 */

import { Context } from '@deepseek-ai/cordis'
import { notesDomain } from './domain.ts'
import { NotesService } from './service.ts'
import { installNotesSettings } from './settings.ts'
import { installNotesReferencePrompt } from './agent/reference.ts'
import { installNotesTools } from './agent/tools.ts'

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
      // agent 桥是可选增强：tools/systemPrompt 服务注册后（或已注册）挂载。
      // 它绝不能把核心的 NotesService 一起拖垮——任何一步抛错都只降级桥本身，
      // 服务照常注册。
      installNotesToolsWhenReady(ctx)
      installNotesReferencePromptWhenReady(ctx)
    } catch (error) {
      void domain.close()
      throw error
    }
  })
}

/**
 * 在 tools 服务可用后注册 notes_* 工具。
 * 用 ctx.inject 而非 ctx.get 判存：tools 行与插件行的激活次序由服务可用性驱动
 * （base 装配注释：row order 不承载加载语义），插件先于 tools 就绪时一次性判存
 * 会永久漏挂。ctx.inject 在服务注册时被 cordis notify 唤醒，任何到达次序都能
 * 挂上；宿主从不提供 tools 时 fiber 挂起、随 ctx 卸载清理，不阻塞也不报错。
 */
export function installNotesToolsWhenReady(ctx: Context): void {
  void ctx.inject(['tools'], (toolsCtx) => {
    try {
      installNotesTools(toolsCtx)
    } catch (error) {
      toolsCtx.logger.warn('[plugin-notes] agent tools disabled:', error)
    }
  })
}

/** systemPrompt 可用后注册 note:// mention 的引用引导（策略同上）。 */
export function installNotesReferencePromptWhenReady(ctx: Context): void {
  void ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      installNotesReferencePrompt(promptCtx)
    } catch (error) {
      promptCtx.logger.warn('[plugin-notes] reference prompt disabled:', error)
    }
  })
}
