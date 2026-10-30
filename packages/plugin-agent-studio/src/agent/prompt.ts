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
      `当用户的任务适合它时，直接把任务交给它：delegate_agent({ agent: "${profile.name}", task: "你根据对话判断的子任务" })。`,
      '不要自己先做一遍再叫它，也不要要求用户先填写任务文本。',
      '只有明显不需要这个角色的任务，才由你自己处理。',
    ].join('\n')
  }

  const team = binding.teamId === undefined ? undefined : service.listTeams().find((item) => item.id === binding.teamId)
  if (team === undefined) return ''
  const lines = [
    '## Agent Studio（当前会话）',
    `当前团队：${team.name}。`,
    '成员：',
    ...team.members.map((member) => `- ${member.name}：${member.description}`),
    '当用户任务需要多个角色（设计 / 实现 / 审查 / 测试）时，先按上面的成员名调用 spawn_teammate 创建成员，再把子任务分配给你判断合适的成员；不要自己把所有角色都演一遍。',
    '成员之间可以直接用 send_message 协作；你负责拆任务、同步上下文、验收结果。临时帮手用 delegate_agent({ agent, task })。',
    '不要要求用户先填写任务或手动创建成员。',
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
