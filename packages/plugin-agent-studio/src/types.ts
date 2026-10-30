/** Agent Studio 的跨端共享类型。 */

export type TeamMode = 'none' | 'solo' | 'team'
export type AgentContextMode = 'fresh' | 'fork'

export interface ModelChoice {
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens?: number
}

export interface AgentProfile {
  id: string
  /** lower-kebab，<=64，不能是 "lead"；作为 teammate 名字使用。 */
  name: string
  displayName: string
  description: string
  /** 角色设定，拼进初始任务。 */
  rolePrompt: string
  /** 启动对话框的默认任务。 */
  defaultTask: string
  /** 空 = 继承 Lead（团队）/ 部署默认（solo）。 */
  presetId?: string
  /** null = 继承 Lead。 */
  model: ModelChoice | null
  context: AgentContextMode
  /** delegate_agent 允许的委派深度，默认 1。 */
  maxDepth: number
  /** 二期像素头像种子。 */
  avatarSeed: string
  createdAt: number
  updatedAt: number
}

export interface TeamProfile {
  id: string
  name: string
  description: string
  members: AgentProfile[]
  createdAt: number
  updatedAt: number
}

export interface SessionBinding {
  sessionId: string
  mode: TeamMode
  profileId?: string
  teamId?: string
  updatedAt: number
}

export interface LaunchAssignment {
  id: string
  leadSessionId: string
  teamId: string
  memberName: string
  profileId: string
  createdAt: number
}

export interface StudioCapabilities {
  agentTeams: boolean
  seam: boolean
  seamStartMethod: 'startActivation' | 'startContinuable' | null
  perMemberAgentOptions: boolean
  perMemberAgentPreset: boolean
  agentPresets: boolean
  models: boolean
  tools: boolean
  maxMembers: number
}

export interface StudioMemberRow {
  id: string
  name: string
  role: 'lead' | 'teammate'
  status: 'running' | 'inactive' | 'provisioning' | 'failed'
  description?: string
  model?: string
  diagnostics?: string[]
}

export interface LaunchMemberResult {
  name: string
  id?: string
  model?: string
  status?: string
  error?: string
}

export interface LaunchTeamResult {
  members: LaunchMemberResult[]
  failed: LaunchMemberResult[]
}

export interface AgentStudioModelGroup {
  provider: string
  models: Array<{ id: string; name: string; reasoningEfforts?: string[] }>
}

export interface AgentStudioPresetRow {
  id: string
  name: string
  description?: string
}

export interface SaveProfileInput {
  profile: AgentProfile
}

export interface SaveTeamInput {
  team: TeamProfile
}

export interface SetBindingInput {
  sessionId: string
  mode: TeamMode
  profileId?: string
  teamId?: string
}

export interface LaunchInput {
  sessionId: string
  task: string
  profileId?: string
  teamId?: string
  memberTasks?: Record<string, string>
}

export interface DelegateInput {
  agent: string
  task: string
  context?: AgentContextMode
}
