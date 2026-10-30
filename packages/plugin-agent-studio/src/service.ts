/** ctx.agentStudio：profile/team 存储、会话绑定、solo/team 启动、delegate 解析。 */

import { randomUUID } from 'node:crypto'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { agentStudioDomain } from './domain.ts'
import { storageKey, validateMemberName, validateProfile, validateTeam } from './domain.ts'
import type { SeamResult } from './seam.ts'
import {
  serviceOf, type AgentPresetsLike, type AgentRegistryLike, type AgentTeamsLike, type LlmLike,
  type MemberRowLike, type RuntimeAgent, type SubagentsLike,
} from './runtime.ts'
import type {
  AgentProfile, AgentStudioModelGroup, AgentStudioPresetRow, DelegateInput, LaunchInput, LaunchMemberResult,
  LaunchTeamResult, ModelChoice, SessionBinding, StudioCapabilities, StudioMemberRow, TeamProfile,
} from './types.ts'

export interface AgentStudioServiceConfig {
  domain: Domain<typeof agentStudioDomain>
  maxMembers?: number
}

function now(): number {
  return Date.now()
}

function asModel(value: ModelChoice | null | undefined): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined
  return {
    provider: value.provider,
    model: value.model,
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }),
    ...(value.maxTokens === undefined ? {} : { maxTokens: value.maxTokens }),
  }
}

function promptText(text: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text }]
}

export class AgentStudioService extends TypertRemoteService {
  private readonly hostCtx: Context
  private readonly domain: Domain<typeof agentStudioDomain>
  private readonly profiles: KvTable<string, AgentProfile>
  private readonly teams: KvTable<string, TeamProfile>
  private readonly bindings: KvTable<string, SessionBinding>
  private readonly assignments: KvTable<string, { id: string; leadSessionId: string; teamId: string; memberName: string; profileId: string; createdAt: number }>

  private readonly profileCache = new Map<string, AgentProfile>()
  private readonly teamCache = new Map<string, TeamProfile>()
  private readonly bindingCache = new Map<string, SessionBinding>()
  private readonly assignmentCache = new Map<string, Map<string, { profileId: string; teamId: string }>>()
  private seam: SeamResult | null = null
  private readonly configuredMax: number

  constructor(ctx: Context, config: AgentStudioServiceConfig) {
    super(ctx, 'agentStudio')
    this.hostCtx = ctx
    this.domain = config.domain
    this.profiles = config.domain.table('profiles')
    this.teams = config.domain.table('teams')
    this.bindings = config.domain.table('bindings')
    this.assignments = config.domain.table('assignments')
    this.configuredMax = config.maxMembers ?? 8
  }

  /** 载入缓存；seam 安装前必须 await。 */
  async ready(): Promise<void> {
    this.profileCache.clear()
    for (const profile of Array.from(this.profiles.entries(), ([, value]) => value)) {
      this.profileCache.set(profile.id, profile)
    }
    this.teamCache.clear()
    for (const team of Array.from(this.teams.entries(), ([, value]) => value)) {
      this.teamCache.set(team.id, team)
    }
    this.bindingCache.clear()
    for (const binding of Array.from(this.bindings.entries(), ([, value]) => value)) {
      this.bindingCache.set(binding.sessionId, binding)
    }
    this.assignmentCache.clear()
    for (const assignment of Array.from(this.assignments.entries(), ([, value]) => value)) {
      const byName = this.assignmentCache.get(assignment.leadSessionId) ?? new Map<string, { profileId: string; teamId: string }>()
      byName.set(assignment.memberName, { profileId: assignment.profileId, teamId: assignment.teamId })
      this.assignmentCache.set(assignment.leadSessionId, byName)
    }
  }

  setSeam(seam: SeamResult): void {
    this.seam = seam
  }

  getSeam(): SeamResult | null {
    return this.seam
  }

  private agents(): AgentRegistryLike | undefined {
    return serviceOf<AgentRegistryLike>(this.hostCtx, 'agents')
  }

  private agentTeams(): AgentTeamsLike | undefined {
    return serviceOf<AgentTeamsLike>(this.hostCtx, 'agentTeams')
  }

  private subagents(): SubagentsLike | undefined {
    return serviceOf<SubagentsLike>(this.hostCtx, 'subagents')
  }

  private llm(): LlmLike | undefined {
    return serviceOf<LlmLike>(this.hostCtx, 'llm')
  }

  private presets(): AgentPresetsLike | undefined {
    return serviceOf<AgentPresetsLike>(this.hostCtx, 'agentPresets')
  }

  private maxMembers(): number {
    const team = this.agentTeams() as (AgentTeamsLike & { config?: { maxMembers?: number } }) | undefined
    return team?.config?.maxMembers ?? this.configuredMax
  }

  resolveLead(sessionId: string): RuntimeAgent {
    const agents = this.agents()
    if (agents === undefined) throw new Error('agents 服务不可用')
    const agent = agents.get(sessionId)
    if (agent === undefined) throw new Error(`会话 ${sessionId} 未加载，无法启动 agent`)
    const parentId = agent.session.header.parentSession
    if (parentId !== undefined) {
      const parent = agents.get(parentId)
      if (parent !== undefined && this.agentTeams()?.tryMembership?.(agent)?.role === 'teammate') return parent
    }
    return agent
  }

  private async startActivation(spec: Parameters<NonNullable<SubagentsLike['startActivation']>>[0]): Promise<{ childId: string }> {
    const subagents = this.subagents()
    if (subagents === undefined) throw new Error('subagents 服务不可用')
    const start = subagents.startActivation ?? subagents.startContinuable
    if (start === undefined) throw new Error('当前宿主没有可用的 subagent startActivation/startContinuable')
    return start.call(subagents, spec)
  }

  private async spawnTeammate(lead: RuntimeAgent, name: string, description: string, prompt: string, context: 'fresh' | 'fork'): Promise<MemberRowLike> {
    const teams = this.agentTeams()
    if (teams === undefined) throw new Error('agentTeams 服务不可用')
    const controller = new AbortController()
    const result = await teams.spawnTeammate(lead, {
      name,
      description,
      prompt: promptText(prompt),
      context,
      provider: context === 'fork' ? 'fork' : 'spawn',
      signal: controller.signal,
    })
    return result.member
  }

  // ── profiles ────────────────────────────────────────────────────────

  listProfiles(): AgentProfile[] {
    return Array.from(this.profileCache.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveProfile(input: { profile: AgentProfile }): Promise<AgentProfile> {
    const profile = {
      ...input.profile,
      id: input.profile.id.trim() === '' ? randomUUID() : input.profile.id,
    }
    const error = validateProfile(profile)
    if (error !== undefined) throw new Error(error)
    const duplicate = this.listProfiles().find((item) => item.name === profile.name && item.id !== profile.id)
    if (duplicate !== undefined) throw new Error(`已存在同名 agent：${profile.name}`)
    const existing = this.profileCache.get(profile.id)
    const timestamp = now()
    const saved: AgentProfile = {
      ...profile,
      id: profile.id === '' ? randomUUID() : profile.id,
      maxDepth: Number.isInteger(profile.maxDepth) ? Math.min(8, Math.max(0, profile.maxDepth)) : 1,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    await this.profiles.put(saved.id, saved)
    this.profileCache.set(saved.id, saved)
    return saved
  }

  async deleteProfile(id: string): Promise<boolean> {
    this.profileCache.delete(id)
    await this.profiles.delete(id)
    return true
  }

  // ── teams ───────────────────────────────────────────────────────────

  listTeams(): TeamProfile[] {
    return Array.from(this.teamCache.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveTeam(input: { team: TeamProfile }): Promise<TeamProfile> {
    const team = { ...input.team }
    const error = validateTeam(team)
    if (error !== undefined) throw new Error(error)
    const existing = this.teamCache.get(team.id)
    const timestamp = now()
    const saved: TeamProfile = {
      ...team,
      id: team.id === '' ? randomUUID() : team.id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    await this.teams.put(saved.id, saved)
    this.teamCache.set(saved.id, saved)
    return saved
  }

  async deleteTeam(id: string): Promise<boolean> {
    this.teamCache.delete(id)
    await this.teams.delete(id)
    return true
  }

  // ── binding ─────────────────────────────────────────────────────────

  private defaultBinding(sessionId: string): SessionBinding {
    return { sessionId, mode: 'none', updatedAt: 0 }
  }

  getBinding(sessionId: string): SessionBinding {
    return this.bindingCache.get(sessionId) ?? this.defaultBinding(sessionId)
  }

  bindingForSession(sessionId: string): SessionBinding {
    return this.getBinding(sessionId)
  }

  async setBinding(input: { sessionId: string; mode: SessionBinding['mode']; profileId?: string; teamId?: string }): Promise<SessionBinding> {
    if (input.mode === 'solo' && input.profileId === undefined) throw new Error('solo 模式需要 profileId')
    if (input.mode === 'team' && input.teamId === undefined) throw new Error('team 模式需要 teamId')
    const binding: SessionBinding = {
      sessionId: input.sessionId,
      mode: input.mode,
      ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
      ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
      updatedAt: now(),
    }
    await this.bindings.put(storageKey(input.sessionId), binding)
    this.bindingCache.set(input.sessionId, binding)
    return binding
  }

  // ── model / preset catalogs ─────────────────────────────────────────

  async listModels(): Promise<AgentStudioModelGroup[]> {
    const llm = this.llm()
    if (llm === undefined) return []
    const providers = llm.listProviders()
    const groups: AgentStudioModelGroup[] = []
    for (const provider of providers) {
      const id = provider.id ?? provider.name
      if (id === undefined || id === '') continue
      try {
        const models = await llm.listModels(id)
        groups.push({
          provider: id,
          models: models.map((model) => ({
            id: model.id,
            name: model.name ?? model.id,
            reasoningEfforts: model.reasoningEfforts === undefined ? [] : [...model.reasoningEfforts],
          })),
        })
      } catch {
        // 单个 provider 失败不拖垮整个目录。
      }
    }
    return groups
  }

  async listPresets(): Promise<AgentStudioPresetRow[]> {
    const presets = this.presets()
    if (presets === undefined) return []
    try {
      const rows = await presets.list()
      return rows.map((row) => ({
        id: row.id,
        name: row.name ?? row.id,
        ...(row.description === undefined ? {} : { description: row.description }),
      }))
    } catch {
      return []
    }
  }

  getCapabilities(): StudioCapabilities {
    const startMethod = this.seam?.startMethod ?? null
    return {
      agentTeams: this.agentTeams() !== undefined,
      seam: this.seam?.installed === true,
      seamStartMethod: startMethod,
      perMemberAgentOptions: this.seam?.installed === true,
      perMemberAgentPreset: this.seam?.installed === true,
      agentPresets: this.presets() !== undefined,
      models: this.llm() !== undefined,
      tools: serviceOf(this.hostCtx, 'tools') !== undefined,
      maxMembers: this.maxMembers(),
    }
  }

  // ── profile / team lookup for seam / tools ──────────────────────────

  profileByName(name: string): AgentProfile | undefined {
    return this.listProfiles().find((profile) => profile.name === name)
  }

  resolveAssignmentProfile(leadId: string, memberName: string): AgentProfile | undefined {
    const assignment = this.assignmentCache.get(leadId)?.get(memberName)
    if (assignment !== undefined) {
      // 团队快照优先：团队编辑后不随 agent 库的后续修改漂移。
      const team = this.teamCache.get(assignment.teamId)
      const snapshot = team?.members.find((member) => member.name === memberName)
      if (snapshot !== undefined) return snapshot
      const direct = this.profileCache.get(assignment.profileId)
      if (direct !== undefined) return direct
    }

    // 没有显式 launch 时，模型可能直接按提示里的名字 spawn_teammate；
    // 从当前会话的绑定里找同名成员/单人 profile。
    const binding = this.bindingCache.get(leadId)
    if (binding?.mode === 'team' && binding.teamId !== undefined) {
      const team = this.teamCache.get(binding.teamId)
      return team?.members.find((member) => member.name === memberName)
    }
    if (binding?.mode === 'solo' && binding.profileId !== undefined) {
      const profile = this.profileCache.get(binding.profileId)
      if (profile?.name === memberName) return profile
    }
    return undefined
  }

  // ── launch ──────────────────────────────────────────────────────────

  async launchSolo(input: { sessionId: string; profileId: string; task: string }): Promise<{ childId: string }> {
    const profile = this.profileCache.get(input.profileId)
    if (profile === undefined) throw new Error('找不到 profile')
    if (input.task.trim() === '') throw new Error('任务不能为空')
    if (profile.context === 'fork' && profile.presetId !== undefined) throw new Error('fork 成员不支持独立 preset')
    const lead = this.resolveLead(input.sessionId)
    const model = asModel(profile.model)
    return this.startActivation({
      provider: 'spawn',
      label: profile.displayName,
      delivery: 'parent',
      request: {
        prompt: promptText(this.composePrompt(profile, input.task, 'solo')),
        parent: lead,
        ...(profile.presetId === undefined ? {} : { agentPreset: profile.presetId }),
        ...(model === undefined ? {} : { agentOptions: model }),
      },
    })
  }

  async launchTeam(input: LaunchInput): Promise<LaunchTeamResult> {
    const teamId = input.teamId
    if (teamId === undefined) throw new Error('team 模式需要 teamId')
    const team = this.teamCache.get(teamId)
    if (team === undefined) throw new Error('找不到团队')
    if (this.seam?.installed !== true) throw new Error('当前宿主无法安装成员 preset/model 注入 seam；请先使用 solo 或安装兼容包')
    const lead = this.resolveLead(input.sessionId)
    const existing = new Set(
      (this.agentTeams()?.listMembers(lead) ?? [])
        .filter((member) => member.role === 'teammate')
        .map((member) => member.name),
    )
    const max = this.maxMembers()
    if (existing.size + team.members.length > max) throw new Error(`团队人数超过上限 ${max}`)
    for (const member of team.members) {
      const error = validateMemberName(member.name)
      if (error !== undefined) throw new Error(`${member.name}：${error}`)
      if (existing.has(member.name)) throw new Error(`本会话已使用过名字 ${member.name}，请改名或新开会话`)
      if (member.context === 'fork' && member.presetId !== undefined) throw new Error(`${member.name}：fork 成员不支持独立 preset`)
    }

    const members: LaunchMemberResult[] = []
    const failed: LaunchMemberResult[] = []
    for (const member of team.members) {
      const assignmentId = storageKey(lead.id, team.id, member.name)
      await this.assignments.put(assignmentId, {
        id: assignmentId,
        leadSessionId: lead.id,
        teamId: team.id,
        memberName: member.name,
        profileId: member.id,
        createdAt: now(),
      })
      const byName = this.assignmentCache.get(lead.id) ?? new Map<string, { profileId: string; teamId: string }>()
      byName.set(member.name, { profileId: member.id, teamId: team.id })
      this.assignmentCache.set(lead.id, byName)

      const task = input.memberTasks?.[member.name] ?? member.defaultTask ?? input.task
      try {
        const row = await this.spawnTeammate(lead, member.name, member.description, this.composePrompt(member, task, 'team'), member.context)
        members.push({ name: member.name, id: row.id, model: row.model, status: row.status })
      } catch (error) {
        failed.push({ name: member.name, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { members, failed }
  }

  async launch(input: LaunchInput): Promise<LaunchTeamResult | { childId: string }> {
    if (input.teamId !== undefined) return this.launchTeam(input)
    if (input.profileId !== undefined) return this.launchSolo({ sessionId: input.sessionId, profileId: input.profileId, task: input.task })
    throw new Error('launch 需要 profileId 或 teamId')
  }

  composePrompt(profile: AgentProfile, task: string, mode: 'solo' | 'team'): string {
    const lines = [
      mode === 'team'
        ? `你是 ${profile.displayName}（${profile.name}），当前团队的成员。`
        : `你是 ${profile.displayName}（${profile.name}）。`,
      `职责：${profile.description}`,
      '',
      '角色设定：',
      profile.rolePrompt.trim() === '' ? '（无）' : profile.rolePrompt.trim(),
      '',
      '本次任务：',
      task.trim(),
    ]
    if (mode === 'team') {
      lines.push('', '协作约定：只处理自己负责的范围；需要其他成员时用 send_message；完成后向 lead 汇报。')
    } else {
      lines.push('', '完成后直接给出结果；不要假设有其他团队成员。')
    }
    return lines.join('\n')
  }

  async delegate(caller: RuntimeAgent, input: DelegateInput): Promise<{ childId: string }> {
    const profile = this.profileByName(input.agent)
    if (profile === undefined) {
      const names = this.listProfiles().map((item) => item.name).join(', ')
      throw new Error(`未知 agent：${input.agent}${names === '' ? '' : `（可用：${names}）`}`)
    }
    const context = input.context ?? profile.context
    if (context === 'fork' && profile.presetId !== undefined) throw new Error('fork 成员不支持独立 preset')
    const depth = caller.session.header.delegationDepth ?? 0
    if (depth >= profile.maxDepth) throw new Error(`已达 ${profile.name} 的委派深度上限 ${profile.maxDepth}`)
    const model = asModel(profile.model)
    return this.startActivation({
      provider: 'spawn',
      label: profile.displayName,
      delivery: 'parent',
      request: {
        prompt: promptText(this.composePrompt(profile, input.task, 'solo')),
        parent: caller,
        maxDepth: profile.maxDepth,
        ...(profile.presetId === undefined ? {} : { agentPreset: profile.presetId }),
        ...(model === undefined ? {} : { agentOptions: model }),
      },
    })
  }

  listRoster(sessionId: string): StudioMemberRow[] {
    const teams = this.agentTeams()
    if (teams === undefined) return []
    const lead = this.resolveLead(sessionId)
    return teams.listMembers(lead).map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      status: row.status,
      ...(row.description === undefined ? {} : { description: row.description }),
      ...(row.model === undefined ? {} : { model: row.model }),
      ...(row.diagnostics === undefined ? {} : { diagnostics: row.diagnostics }),
    }))
  }
}

/** 手工复刻 @Remote 产物；清单必须与 client 端 descriptors 的 method 名一致。 */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

function markRemoteMethods(prototype: object, methods: readonly string[]): void {
  Object.defineProperty(prototype, REMOTE_METHODS, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(
        methods.map((method) =>
          Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' as const }) }),
        ),
      ),
    }),
  })
}

markRemoteMethods(AgentStudioService.prototype, [
  'listProfiles',
  'saveProfile',
  'deleteProfile',
  'listTeams',
  'saveTeam',
  'deleteTeam',
  'listModels',
  'listPresets',
  'getCapabilities',
  'getBinding',
  'setBinding',
  'launch',
  'listRoster',
])

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentStudio: AgentStudioService
  }
}
