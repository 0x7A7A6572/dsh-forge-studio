/**
 * @zzerx/dsh-plugin-daily-log —— host 入口。
 * 打开 daily-log 域 → 提供 ctx.dailyLog 服务（client 经 Typert remote 直连）→
 * 注册设置命名空间 → 装配内置渠道（git/claude/codex）→ 读取 DSH 工作区项目候选。
 *
 * DSH 会话渠道（正文读取）接入点：sources/dsh-channel.ts —— 需通过
 * ctx.workspaceRegistry（项目 → sessionIds）+ dsh session 事件读取（带时间戳），
 * 因 dev profile 无会话数据且读取 API 需专项校准，尚未启用（TODO 下轮接入）。
 */

import { Context } from '@deepseek-ai/cordis'
import { dailyLogDomain } from './domain.ts'
import { DailyLogService } from './service.ts'
import { installDailyLogSettings } from './settings.ts'
import { builtinChannels } from './sources/index.ts'
import { installDailyLogTools } from './agent/tools.ts'
import { installDailyLogReferencePrompt } from './agent/reference.ts'

export const name = '@zzerx/dsh-plugin-daily-log'
export const inject = ['storageDomain']

/** workspaceRegistry（dsh-workspace）的最小视图，仅取候选发现所需字段。 */
interface WorkspaceRegistryLike {
  list(): Array<{ path: string; title: string; sessionIds: readonly unknown[] }>
}

/**
 * 读取 DSH 工作区已添加项目（ctx.workspaceRegistry 同步投影）。
 * registry 未装配（web profile 缺 dsh-web-app 等）或读取异常一律返回 []，
 * 由 service 端优雅降级为「无工作区候选」。
 */
async function readWorkspaceProjects(
  ctx: Context,
): Promise<Array<{ path: string; title?: string; sessionIds: readonly string[] }>> {
  const registry = (ctx as unknown as { get(name: string): WorkspaceRegistryLike | undefined }).get('workspaceRegistry')
  if (!registry || typeof registry.list !== 'function') return []
  try {
    return registry
      .list()
      .map((w) => ({ path: w.path, title: w.title, sessionIds: w.sessionIds.map((x) => String(x)) }))
  } catch {
    return []
  }
}

export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(dailyLogDomain)
  try {
    ctx.effect(() => () => { void domain.close() })
    // 用 new（而非 ctx.plugin）：把 dailyLog 服务 provide 在本 apply 的 fiber 上，
    // 后续 ctx.inject(['tools'], ...) 子 fiber 才能沿祖先链读到 ctx.dailyLog。
    new DailyLogService(ctx, {
      domain,
      channels: builtinChannels,
      // 数据源页「DSH 工作区」组的候选来源（含每项目的 sessionIds，供 dsh 会话渠道）。
      workspaceProjects: () => readWorkspaceProjects(ctx),
    })
    installDailyLogSettings(ctx)
    installDailyLogAgentBridgeWhenReady(ctx)
  } catch (error) {
    void domain.close()
    throw error
  }
}

/**
 * agent 桥可选增强：tools 服务注册后挂载 daily_log_* 工具，systemPrompt 注册后
 * 挂载报告引导。任何一步抛错只降级桥本身，不拖垮核心服务。
 */
export function installDailyLogAgentBridgeWhenReady(ctx: Context): void {
  void ctx.inject(['tools'], (toolsCtx) => {
    try {
      installDailyLogTools(toolsCtx)
    } catch (error) {
      toolsCtx.logger.error('[plugin-daily-log] agent tools install failed — daily_log_* unavailable to sessions:', error)
    }
  })
  void ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      installDailyLogReferencePrompt(promptCtx)
    } catch (error) {
      promptCtx.logger.warn('[plugin-daily-log] reference prompt disabled:', error)
    }
  })
}
