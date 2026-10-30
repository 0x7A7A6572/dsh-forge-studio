/** 动态 systemPrompt 段：把当前会话的团队/单人选择告诉模型。 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentStudioService } from '../service.ts'
import { isRuntimeAgent, type RuntimeAgent } from '../runtime.ts'

export const AGENT_STUDIO_CONTEXT = 'agent-studio:session'

function renderForAgent(service: AgentStudioService, agent: RuntimeAgent): string {
  const leadId = agent.session.header.parentSession ?? agent.id
  const binding = service.bindingForSession(leadId)
  if (binding.mode === 'none') return ''

  if (binding.mode === 'solo') {
    const profile = binding.profileId === undefined ? undefined : service.listProfiles().find((item) => item.id === binding.profileId)
    if (profile === undefined) return ''
    return [
      '## Agent Studio（当前会话）',
      `当前单人 Agent：${profile.displayName}（${profile.name}）。`,
      `职责：${profile.description}`,
      `需要它处理任务时，调用 delegate_agent({ agent: "${profile.name}", task: "..." })。`,
    ].join('\n')
  }

  const team = binding.teamId === undefined ? undefined : service.listTeams().find((item) => item.id === binding.teamId)
  if (team === undefined) return ''
  const lines = [
    '## Agent Studio（当前会话）',
    `当前团队：${team.name}。`,
    '成员：',
    ...team.members.map((member) => `- ${member.name}：${member.description}`),
    '用 spawn_teammate 创建团队成员；临时帮手用 delegate_agent({ agent, task })。',
  ]
  return lines.join('\n')
}

export function installAgentStudioPrompt(ctx: Context, service: AgentStudioService): () => void {
  return ctx.systemPrompt.context({
    name: AGENT_STUDIO_CONTEXT,
    order: 2960,
    text: (renderCtx: unknown) => {
      try {
        const agent = (renderCtx as { agent?: unknown } | undefined)?.agent
        if (!isRuntimeAgent(agent)) return ''
        return renderForAgent(service, agent)
      } catch {
        return ''
      }
    },
  })
}
