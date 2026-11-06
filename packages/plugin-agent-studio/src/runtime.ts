/** 对宿主服务的结构化最小视图，避免把实验包的内部类型带进插件。 */

export interface RuntimeAgent {
  id: string
  status?: string
  options?: { provider?: string; model?: string }
  session: {
    header: {
      parentSession?: string
      delegationDepth?: number
      preset?: string
    }
  }
}

export interface AgentRegistryLike {
  get(id: string): RuntimeAgent | undefined
  list(): RuntimeAgent[]
}

export interface MemberRowLike {
  id: string
  name: string
  role: 'lead' | 'teammate'
  status: 'running' | 'inactive' | 'provisioning' | 'failed'
  description?: string
  model?: string
  provider?: string
  context?: string
  diagnostics?: string[]
}

export interface SpawnTeammateRequestLike {
  name: string
  description: string
  prompt: unknown
  context: 'fresh' | 'fork'
  provider: string
  signal: AbortSignal
}

export interface AgentTeamsLike {
  listMembers(caller: RuntimeAgent): MemberRowLike[]
  spawnTeammate(caller: RuntimeAgent, request: SpawnTeammateRequestLike): Promise<{ member: MemberRowLike }>
  tryMembership?(agent: RuntimeAgent): { role?: string; name?: string; id?: string; root?: RuntimeAgent } | undefined
  interrupt?(caller: RuntimeAgent, targetName: string): { previousStatus?: string }
}

export interface ActivationRequestLike {
  prompt: unknown
  parent: RuntimeAgent
  agentPreset?: string
  agentOptions?: Record<string, unknown>
  maxDepth?: number
}

export interface ActivationSpecLike {
  provider: string
  label?: string
  delivery?: 'parent' | 'caller'
  signal?: AbortSignal
  childId?: string
  request: ActivationRequestLike
}

export interface SubagentProviderLike {
  capabilities?: { agentPreset?: boolean; agentOptions?: boolean }
}

export interface SubagentsLike {
  startActivation?(spec: ActivationSpecLike): Promise<{ childId: string; messageId?: string }>
  startContinuable?(spec: ActivationSpecLike): Promise<{ childId: string; messageId?: string }>
  getProvider?(name: string): SubagentProviderLike | undefined
}

export interface AgentPresetsLike {
  list(): Promise<readonly { id: string; name?: string; description?: string }[]>
  resolve(id: string): Promise<{ id: string }>
}

export interface LlmLike {
  listProviders(): Array<{ id?: string; name?: string }>
  listModels(provider: string): Promise<Array<{ id: string; name?: string; reasoningEfforts?: readonly string[] }>>
  resolveCallConfig?(config: {
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<{ provider: string; model: string; reasoningEffort?: string }>
}

export interface ToolsLike {
  register(tool: unknown): () => void
}

export interface SystemPromptLike {
  context(options: {
    name: string
    order?: number
    text: (renderCtx: unknown) => string
  }): () => void
}

export interface CapabilityProbe {
  startMethod: 'startActivation' | 'startContinuable' | null
  hasSubagentStart: boolean
  hasSpawnTeammate: boolean
  providerPresetCapable: boolean
}

export function serviceOf<T>(ctx: unknown, name: string): T | undefined {
  try {
    const get = (ctx as { get?: (id: string) => T | undefined }).get
    return typeof get === 'function' ? get.call(ctx, name) : undefined
  } catch {
    return undefined
  }
}

export function isRuntimeAgent(value: unknown): value is RuntimeAgent {
  if (typeof value !== 'object' || value === null) return false
  const agent = value as Partial<RuntimeAgent>
  return typeof agent.id === 'string'
    && typeof agent.session === 'object'
    && agent.session !== null
    && typeof agent.session.header === 'object'
    && agent.session.header !== null
}
