/**
 * 按 agent scope 注册一组 agent 侧贡献（工具 / systemPrompt 段），幂等。
 *
 * 工具与 prompt 段的可见性都是按 scope 现算的（ToolRuntime.register 明说
 * 'Register globally or in the calling agent scope'，SystemPrompt 是 Scoped 服务），
 * 因此「用到时才注入」= 拿到 agent 的 scope ctx 后注册。公开类型 Agent 只有 { id }，
 * scope ctx 属于宿主运行时增广 —— 用窄接口读取，集中在 agentScopeOf 一处。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** agent scope ctx 的最小视图：tools 必需，systemPrompt 可缺（宿主可能未装配）。 */
export interface AgentScopeContext {
  readonly tools: {
    register(definition: ToolDefinition): () => void
  }
  readonly systemPrompt?: {
    section(section: { name: string; order: number; text: string }): () => void
  }
}

/** 读 agent 的 scope ctx；宿主未暴露时抛错（由调用方转成面向模型的错误文本）。 */
export function agentScopeOf(agent: Agent): AgentScopeContext {
  const scope = (agent as unknown as { ctx?: AgentScopeContext }).ctx
  if (scope === undefined || scope.tools === undefined) {
    throw new Error('[plugin-daily-log] agent scope context is unavailable (agent.ctx)')
  }
  return scope
}

/** 一次 enable 要建立的全部注册；返回的 disposer 释放它们。 */
export type GateContribution = (scope: AgentScopeContext) => () => void

export interface ToolGate {
  /** 幂等启用；已启用或 gate 已关闭返回 false。 */
  enable(agent: Agent): boolean
  isEnabled(agent: Agent): boolean
  /** 释放全部注册并关闭 gate（插件卸载与测试用）。 */
  dispose(): void
}

export function createToolGate(contribution: GateContribution): ToolGate {
  const installed = new WeakMap<Agent, () => void>()
  const all = new Set<() => void>()
  let closed = false
  return {
    enable(agent) {
      if (closed || installed.has(agent)) return false
      const release = contribution(agentScopeOf(agent))
      installed.set(agent, release)
      all.add(release)
      return true
    },
    isEnabled(agent) {
      return !closed && installed.has(agent)
    },
    dispose() {
      closed = true
      for (const release of all) release()
      all.clear()
    },
  }
}
