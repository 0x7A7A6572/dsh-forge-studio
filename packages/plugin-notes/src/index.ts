/**
 * @zzerx/dsh-plugin-notes —— host 入口。
 * 打开 notes 域（storage-domain）→ 提供 ctx.notes 服务（client UI 经 Typert
 * remote 直连）→ 注册设置命名空间 → 挂载 agent 桥（便签工具）。
 *
 * 便签是独立 UI 形态（侧栏入口 + 便签板浮层），同时把 CRUD 暴露成 agent 工具：
 * 宿主装配了 tools（完整 dsh 装配）时自动注册 notes_* 工具；无 tools 服务的
 * 宿主（纯 UI 数据后端）照常工作，只是不注册工具。
 *
 * 挂载时机（关键）：宿主装配是 service-availability 驱动的（dsh-base 组合注释：
 * 行序不承载加载语义，激活由服务可用性决定）。本插件声明依赖 storageDomain，
 * 可能先于 tools / systemPrompt 服务就绪——因此 agent 桥不能用 apply 时的一次性
 * ctx.get('tools') 判存（服务尚未注册时判存 false 就永久漏挂、无重试）。桥改用
 * ctx.inject 声明依赖：cordis 在服务注册（provide→notify）时唤醒等待中的 fiber，
 * 无论服务先到还是后到都能挂上；宿主从不提供该服务时 fiber 静默挂起、随 ctx
 * 卸载清理，不阻塞核心。
 *
 * apply 是 async 函数（storageDomain 已在静态 inject 中声明，apply 时已就绪）：
 * loader 会 await 异步 setup（域打开 → NotesService 注册 → 设置挂载）完成之后
 * 条目才算激活。不能把 `ctx.inject(['storageDomain'], ...)` 的 fiber 作为 apply
 * 的返回值——cordis 会把 thenable 返回值当作「effect/disposer」收集，fiber 收束
 * 后触发 `safeCollect(fiber)` → 抛 `TypeError("Invalid effect")`，整个插件（含
 * NotesService、设置、agent 工具）都无法加载。
 */
import { Context } from '@deepseek-ai/cordis'
import { notesDomain } from './domain.ts'
import { webdavMetaDomain } from './webdav-domain.ts'
import { createWebdavEngine } from './webdav-backup.ts'
import { NotesService } from './service.ts'
import type { NotesServiceConfig } from './service.ts'
import { installNotesSettings } from './settings.ts'
import { installNotesTools } from './agent/tools.ts'
import { installTaskDispatch } from './agent/task-dispatch.ts'
import { bridgeErrorMessage, bridgeFailed, bridgeInstalled, type NotesAgentBridgeSettled, type NotesAgentBridgeState } from './agent/bridge-state.ts'

export const name = '@zzerx/dsh-plugin-notes'
export const inject = ['storageDomain']

export async function apply(ctx: Context): Promise<void> {
  // storageDomain 已在静态 inject 声明，apply 时可用，无需再包一层 ctx.inject。
  const domain = await ctx.storageDomain.open(notesDomain)
  const metaDomain = await ctx.storageDomain.open(webdavMetaDomain)
  try {
    // 域由本 fiber 负责 close。
    ctx.effect(() => () => { void domain.close() })
    ctx.effect(() => () => { void metaDomain.close() })
    // WebDAV 备份引擎：用闭包引用稍后构造的 NotesService（回调在运行期才触发），
    // 避免循环构造。引擎缺省安全：任何错误都结构化回传，绝不拖垮便签服务。
    let notesService: NotesService | undefined
    const webdav = createWebdavEngine(ctx, {
      listNotes: () => notesService?.list() ?? [],
      replaceAll: async (notes) => {
        if (!notesService) throw new Error('notes 服务未就绪')
        await notesService.replaceAll(notes)
      },
      metaTable: metaDomain.table('meta'),
    })
    // 执行投递（泳道卡执行 → 会话 prompt）为可选增强：装配失败只降级 bridge（dispatch
    // 缺省 → taskExecute 返回 no-dispatch），绝不拖垮 NotesService 注册。
    // 注意用 `new NotesService(ctx, …)` 而非 `ctx.plugin(NotesService, …)`：前者把
    // `notes` 服务 provide 在本 apply 的 fiber 上，后续 `ctx.inject(['tools'], …)`
    // 的子 fiber 才能沿祖先链读到 `ctx.notes`（`ctx.plugin` 会把 notes 挂到兄弟
    // fiber，祖先链读不到 → "cannot get property notes without inject"，工具装不上）。
    notesService = new NotesService(ctx, { domain, dispatch: installTaskDispatchSafely(ctx), webdav })
    // 设置命名空间（client 设置卡片读写）。
    installNotesSettings(ctx)
    // 定时自动检查：每 60s 读配置判断「到期 + 确有变更」才上推；enabled=false、
    // 失败都静默跳过（错误已记入 meta 状态），不炸 host。
    const timer = setInterval(() => {
      void webdav.checkAutomatic().catch((error) => {
        ctx.logger.warn('[plugin-notes] webdav automatic check failed:', error)
      })
    }, 60_000)
    ctx.effect(() => () => { clearInterval(timer) })
    // agent 桥是可选增强：tools/systemPrompt 服务注册后（或已注册）挂载。
    // 它绝不能把核心的 NotesService 一起拖垮——任何一步抛错都只降级桥本身，
    // 服务照常注册。
    installNotesAgentBridgeWhenReady(ctx)
  } catch (error) {
    void domain.close()
    void metaDomain.close()
    throw error
  }
}

/**
 * 装配 taskExecute 的 dispatch 回调（降级安全）：任何抛错都只降级 bridge——记录
 * warn 并返回 undefined（taskExecute 走 no-dispatch），绝不破坏 NotesService 注册。
 * dispatch 本身惰性解析 sessionController（见 task-dispatch.ts），装配时无副作用。
 */
export function installTaskDispatchSafely(ctx: Context): NotesServiceConfig['dispatch'] | undefined {
  try {
    return installTaskDispatch(ctx)
  } catch (error) {
    ctx.logger.warn('[plugin-notes] task dispatch disabled:', error)
    return undefined
  }
}

/**
 * agent 桥装配状态写入 ctx.notes（缺省安全：宿主无 NotesService 时跳过，仅日志）。
 */
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
 * 在 tools 服务可用后注册 notes_* 工具，并把结果推入桥状态。
 * 用 ctx.inject 而非 ctx.get 判存：tools 行与插件行的激活次序由服务可用性驱动
 * （base 装配注释：row order 不承载加载语义），插件先于 tools 就绪时一次性判存
 * 会永久漏挂。ctx.inject 在服务注册时被 cordis notify 唤醒，任何到达次序都能
 * 挂上；宿主从不提供 tools 时返回的 promise 永不收束（fiber 挂起、随 ctx 卸载
 * 清理），随 ctx 卸载即止——纯 UI 宿主照常不注册工具。
 *
 * 返回收束态：installed（8 个工具注册完成）或 failed（含人类可读原因）。
 * failed 以 logger.error 级别告警（旧实现仅 warn，会话侧无任何可见信号），并
 * 记录进 ctx.notes.agentBridge——host 可查、经 notes/getAgentBridgeState 端点
 * 透出给 client（后续 UI 渲染点）。
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

/**
 * agent 桥整体装配（apply 与测试共用）：注册 notes_* 工具并把结果推入桥状态。
 */
export function installNotesAgentBridgeWhenReady(ctx: Context): void {
  installNotesToolsWhenReady(ctx)
}