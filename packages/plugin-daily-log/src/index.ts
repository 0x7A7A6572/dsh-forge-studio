/**
 * @zzerx/dsh-plugin-daily-log —— host 入口。
 * 打开 daily-log 域 → 提供 ctx.dailyLog 服务（client 经 Typert remote 直连）→
 * 注册设置命名空间 → 装配内置渠道（git/claude/codex/dsh）→ 读取 DSH 工作区项目候选。
 *
 * DSH 会话渠道（sources/dsh.ts）直接读 <DSH_HOME>/sessions 下的会话文件：
 * 按会话头部 cwd 归属项目，正文为追加写的多帧 zstd，须逐帧解压。
 *
 * agent 侧按需注入：15 个 daily_log_* 工具与详细引导段默认不注册 ——
 * 常态只挂一个常驻派发器工具 daily_log 与一句短指针；模型经 daily_log 工具或
 * 用户敲 /report 触发 gate.enable(agent)，才把整组工具 + 详细段注入该 agent scope。
 */

import { Context } from '@deepseek-ai/cordis'
import { dailyLogDomain } from './domain.ts'
import { DailyLogService } from './service.ts'
import { installDailyLogSettings } from './settings.ts'
import type { DailyLogSettingsAccess } from './settings.ts'
import { builtinChannels } from './sources/index.ts'
import { buildDailyLogTools, installDailyLogTools } from './agent/tools.ts'
import { createToolGate } from './agent/tool-gate.ts'
import type { ToolGate } from './agent/tool-gate.ts'
import { installDailyLogPointerPrompt, registerDailyLogGuidance } from './agent/reference.ts'
import { installReportCommand } from './agent/command-report.ts'

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
    // settings 句柄要交给 /report 指令（开关联动其注册与否），不再丢弃返回值。
    const settings = installDailyLogSettings(ctx)
    installDailyLogAgentBridgeWhenReady(ctx, settings)
  } catch (error) {
    void domain.close()
    throw error
  }
}

/** 建 gate：一次 enable 同时注入 15 个工具 + 详细引导段。 */
export function createDailyLogGate(ctx: Context): ToolGate {
  return createToolGate((scope) => {
    const disposers: Array<() => void> = []
    buildDailyLogTools(ctx.dailyLog, (definition) => {
      disposers.push(scope.tools.register(definition))
    })
    disposers.push(registerDailyLogGuidance(scope))
    return () => { for (const d of disposers.reverse()) d() }
  })
}

/**
 * agent 桥可选增强：tools 服务注册后挂常驻派发器（+ guard / pre-execute 钩子），
 * systemPrompt 注册后挂常驻短指针；/report 指令交给 settings 开关联动。
 * 任何一步抛错只降级桥本身，不拖垮核心服务。
 */
export function installDailyLogAgentBridgeWhenReady(ctx: Context, settings: DailyLogSettingsAccess): void {
  const gate = createDailyLogGate(ctx)
  ctx.effect(() => () => gate.dispose())
  // tools 与 systemPrompt 仍分开 inject：任一缺失只降级该部分（沿用原有容错姿态）。
  void ctx.inject(['tools'], (toolsCtx) => {
    try {
      installDailyLogTools(toolsCtx, gate)
    } catch (error) {
      toolsCtx.logger.error('[plugin-daily-log] agent tools install failed — daily_log_* unavailable to sessions:', error)
    }
  })
  void ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      installDailyLogPointerPrompt(promptCtx)
    } catch (error) {
      promptCtx.logger.error('[plugin-daily-log] pointer prompt install failed:', error)
    }
  })
  installReportCommand(ctx, gate, settings)
}
