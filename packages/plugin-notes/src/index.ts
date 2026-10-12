/**
 * @zzerx/dsh-plugin-notes —— host 入口：打开 notes 域 → 提供 ctx.notes → 注册设置页 → 挂 agent 桥。
 *
 * 装配由服务可用性驱动，行序不承载语义。agent 桥必须用 `ctx.inject` 声明依赖：一次性
 * `ctx.get('tools')` 判存在插件先于 tools 就绪时会永久漏挂。
 */
import { Context } from '@deepseek-ai/cordis'
import { notesDomain } from './domain.ts'
import { webdavMetaDomain } from './webdav-domain.ts'
import { createWebdavEngine } from './webdav-backup.ts'
import { NotesService } from './service.ts'
import type { NotesServiceConfig } from './service.ts'
import { configureNotesSettingsPage, webdavConfigOf, type Config } from './settings.ts'
import { installNotesTools } from './agent/tools.ts'
import { installTaskRuntime } from './agent/task-dispatch.ts'
import { installNotesScheduler } from './scheduler.ts'
import { bridgeErrorMessage, bridgeFailed, bridgeInstalled, type NotesAgentBridgeSettled, type NotesAgentBridgeState } from './agent/bridge-state.ts'

export const name = '@zzerx/dsh-plugin-notes'
export const inject = ['storageDomain']
/** settings 表单的命名空间就是本条目 id。 */
export { Config } from './settings.ts'

// ctx.inject 返回 fiber，不能从 async apply 里 return：cordis 会把 thenable 当 effect 收集并抛。
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(notesDomain)
  const metaDomain = await ctx.storageDomain.open(webdavMetaDomain)
  try {
    ctx.effect(() => () => { void domain.close() })
    ctx.effect(() => () => { void metaDomain.close() })
    // 闭包引用稍后构造的 NotesService：回调运行期才触发，避免循环构造。
    let notesService: NotesService | undefined
    const webdav = createWebdavEngine(ctx, {
      listNotes: () => notesService?.list() ?? [],
      replaceAll: async (notes) => {
        if (!notesService) throw new Error('notes 服务未就绪')
        await notesService.replaceAll(notes)
      },
      metaTable: metaDomain.table('meta'),
      // 每次现取：设置热更新不重挂插件。
      readConfig: () => webdavConfigOf(config),
    })
    // 任务执行运行时是可选增强：装配失败只降级，绝不拖垮 NotesService 注册。
    // 用 `new NotesService(ctx, …)` 而非 `ctx.plugin`：前者把 `notes` 服务 provide 在本 fiber 上，
    // 之后的子 fiber 才能沿祖先链读到 `ctx.notes`（`ctx.plugin` 挂到兄弟 fiber，祖先链读不到）。
    notesService = new NotesService(ctx, { domain, task: installTaskRuntimeSafely(ctx), webdav })
    configureNotesSettingsPage(ctx)
    // 每 60s 判断「到期 + 确有变更」才上推；失败静默跳过。
    const timer = setInterval(() => {
      void webdav.checkAutomatic().catch((error) => {
        ctx.logger.warn('[plugin-notes] webdav automatic check failed:', error)
      })
    }, 60_000)
    ctx.effect(() => () => { clearInterval(timer) })
    // 每 30s 扫到期日程 → taskExecuteScheduled；装配失败只降级（定时不生效）。
    installNotesSchedulerSafely(ctx, notesService)
    installNotesAgentBridgeWhenReady(ctx)
  } catch (error) {
    void domain.close()
    void metaDomain.close()
    throw error
  }
}

/** 任何抛错都只降级：记 warn 并返回 undefined（taskExecute 走 no-dispatch）。 */
export function installTaskRuntimeSafely(ctx: Context): NotesServiceConfig['task'] | undefined {
  try {
    return installTaskRuntime(ctx)
  } catch (error) {
    ctx.logger.warn('[plugin-notes] task dispatch disabled:', error)
    return undefined
  }
}

/** 抛错只记 warn，定时失效，其余能力照常。 */
export function installNotesSchedulerSafely(ctx: Context, notes: NotesService): void {
  try {
    installNotesScheduler(ctx, notes)
  } catch (error) {
    ctx.logger.warn('[plugin-notes] schedule dispatcher disabled:', error)
  }
}

/** 宿主无 NotesService 时跳过，仅日志。 */
function recordBridgeState(ctx: Context, state: NotesAgentBridgeState): void {
  if (ctx.notes?.setAgentBridgeState !== undefined) {
    try {
      ctx.notes.setAgentBridgeState(state)
    } catch (error) {
      ctx.logger.warn('[plugin-notes] bridge state write failed:', error)
    }
  }
}

/**
 * tools 服务可用后注册 notes_* 工具，并把结果推入桥状态。
 * 用 `ctx.inject` 而非 `ctx.get` 判存：插件先于 tools 就绪时一次性判存会永久漏挂。
 * failed 以 error 级别告警（会话侧才看得见），并记录进 ctx.notes.agentBridge。
 */
export function installNotesToolsWhenReady(ctx: Context): Promise<NotesAgentBridgeSettled> {
  return new Promise((resolve) => {
    void ctx.inject(['tools'], (toolsCtx) => {
      try {
        installNotesTools(toolsCtx)
        const settled = bridgeInstalled()
        recordBridgeState(toolsCtx, settled)
        resolve(settled)
      } catch (error) {
        const settled = bridgeFailed(bridgeErrorMessage(error))
        toolsCtx.logger.error('[plugin-notes] agent tools install failed — notes_* unavailable to sessions:', error)
        recordBridgeState(toolsCtx, settled)
        resolve(settled)
      }
    })
  })
}

export function installNotesAgentBridgeWhenReady(ctx: Context): void {
  installNotesToolsWhenReady(ctx)
}
