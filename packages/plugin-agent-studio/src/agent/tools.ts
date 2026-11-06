/** 给模型用的 Agent Studio 工具：delegate_agent / list_agent_profiles。 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AgentStudioService } from '../service.ts'
import { isRuntimeAgent } from '../runtime.ts'
import type { AgentContextMode } from '../types.ts'

export const DELEGATE_TOOL = 'delegate_agent'
export const LIST_PROFILES_TOOL = 'list_agent_profiles'

export function installAgentStudioTools(ctx: Context, service: AgentStudioService): () => void {
  const disposers: Array<() => void> = []

  disposers.push(ctx.tools.register(defineTool({
    name: DELEGATE_TOOL,
    description: 'Delegate a self-contained task to a configured agent profile. The child runs with that profile\'s preset and model instead of inheriting yours. Use list_agent_profiles to see available names.',
    parameters: {
      agent: { type: 'string', required: true, description: 'Agent profile name (lower-kebab-case), e.g. "reviewer".' },
      task: { type: 'string', required: true, description: 'Complete self-contained task for the delegated agent.' },
      context: {
        type: 'string',
        enum: ['fresh', 'fork'],
        description: 'fresh starts without your history; fork inherits your completed turns. Defaults to the profile setting.',
      },
    },
    async execute(args: { agent: string; task: string; context?: AgentContextMode }, exec: unknown) {
      const agent = (exec as { agent?: unknown } | undefined)?.agent
      if (!isRuntimeAgent(agent)) throw new Error('delegate_agent 只能由 live agent 调用')
      const profile = service.profileByName(args.agent)
      if (profile === undefined) {
        const names = service.listProfiles().map((item) => item.name).join(', ')
        throw new Error(`未知 agent：${args.agent}${names === '' ? '' : `（可用：${names}）`}`)
      }
      const context = args.context ?? profile.context
      const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
      const result = await service.delegate(agent, {
        agent: profile.name,
        task: args.task,
        context,
      }, signal)
      return { childId: result.childId, agent: profile.name, model: profile.model?.model ?? 'inherit' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          childId: { type: 'string', required: true },
          agent: { type: 'string', required: true },
          model: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: LIST_PROFILES_TOOL,
    description: 'List configured agent profiles available for delegation.',
    parameters: {},
    async execute() {
      return {
        agents: service.listProfiles().map((profile) => ({
          name: profile.name,
          displayName: profile.displayName,
          description: profile.description,
          model: profile.model?.model ?? 'inherit',
          preset: profile.presetId ?? 'inherit',
        })),
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                displayName: { type: 'string', required: true },
                description: { type: 'string', required: true },
                model: { type: 'string', required: true },
                preset: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
  })))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
