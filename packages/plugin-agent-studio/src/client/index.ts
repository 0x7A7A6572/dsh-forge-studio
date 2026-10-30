/**
 * @zzerx/dsh-plugin-agent-studio/client —— client 入口（browser bundle）。
 *
 * 1. 挂载 agentStudio 远程命名空间；
 * 2. 设置面板注册「智能体工坊」分区；
 * 3. 输入框左侧注册一个 Agent / 团队选择 chip。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { agentStudioOf, mountAgentStudioRemote } from './core/remote.ts'
import { AgentStudioSettings } from './views/settings-section/AgentStudioSettings.tsx'
import { AgentStudioChip } from './views/composer-chip/AgentStudioChip.tsx'

export const name = '@zzerx/dsh-plugin-agent-studio/client'
export const inject = ['slots', 'remote']

export function apply(ctx: Context): void {
  ctx.inject(['slots', 'remote'], async (scoped) => {
    await mountAgentStudioRemote(scoped)
    scoped.inject(['remote.agentStudio', 'remote', 'slots'], (inner) => {
      const studio = agentStudioOf(inner)
      inner.slots.inject('settings.section', () => inner.slots.register({
        name: 'settings.section',
        id: 'agent-studio',
        order: 30,
        label: '智能体工坊',
        inject: () => ({ studio }),
      }, AgentStudioSettings))

      inner.slots.inject('conversation.input.left' as never, () => inner.slots.register({
        name: 'conversation.input.left',
        id: 'agent-studio',
        order: 12,
        inject: () => ({ studio }),
      } as never, AgentStudioChip as never))
    })
  })
}
