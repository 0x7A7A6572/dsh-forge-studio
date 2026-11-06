/**
 * @zzerx/dsh-plugin-agent-studio —— host 入口。
 *
 * 打开 Agent Studio 域 → 提供 ctx.agentStudio 服务（client 经 Typert remote 直连）→
 * 安装官方 Team 的运行时 seam（成员 preset/model 注入）→ 注册 delegate 工具与动态提示段。
 */

import type { Context } from '@deepseek-ai/cordis'
import { agentStudioDomain } from './domain.ts'
import { migrateLegacyKvRecords, resolveAgentStudioDir } from './agent-file-store.ts'
import { AgentStudioService } from './service.ts'
import { installSeam } from './seam.ts'
import { installAgentStudioTools } from './agent/tools.ts'
import { installAgentStudioPrompt } from './agent/prompt.ts'

export const name = '@zzerx/dsh-plugin-agent-studio'
export const inject = ['storageDomain']

export async function apply(ctx: Context): Promise<void> {
  let domain: Awaited<ReturnType<typeof ctx.storageDomain.open>> | undefined
  try {
    // 旧 KV 记录（agent_studio 域的 bindings/assignments）先搬进新域名目录，
    // 必须在 storageDomain.open 之前：后端在 open 时扫描 per-record 文件。
    migrateLegacyKvRecords(resolveAgentStudioDir())
    domain = await ctx.storageDomain.open(agentStudioDomain)
    ctx.effect(() => () => { void domain?.close() })
    const service = new AgentStudioService(ctx, { domain })
    await service.ready()

    // seam 依赖官方 Team / subagent 服务；等它们就绪再装，避免启动顺序导致静默不生效。
    void ctx.inject(['subagents', 'agentTeams'], (seamCtx) => {
      const seam = installSeam(seamCtx, {
        resolveProfile: (leadId, memberName) => service.resolveAssignmentProfile(leadId, memberName),
      })
      service.setSeam(seam)
      return () => seam.dispose()
    })

    void ctx.inject(['tools'], (toolsCtx) => {
      try {
        return installAgentStudioTools(toolsCtx, service)
      } catch (error) {
        toolsCtx.logger.warn('[plugin-agent-studio] tools install failed:', error)
        return undefined
      }
    })

    void ctx.inject(['systemPrompt'], (promptCtx) => {
      try {
        return installAgentStudioPrompt(promptCtx, service)
      } catch (error) {
        promptCtx.logger.warn('[plugin-agent-studio] prompt install failed:', error)
        return undefined
      }
    })
  } catch (error) {
    void domain?.close()
    throw error
  }
}
