/** ctx.agentStudio：profile/team 存储（目录真源）、会话绑定、solo/team 启动、delegate 解析。 */

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { agentStudioDomain } from './domain.ts'
import { storageKey, validateMemberName, validateProfile, validateTeam } from './domain.ts'
import {
  ensureAgentDirs,
  existsMd,
  readAgentProfilesSync,
  readTeamsSync,
  removeAgentFile,
  removeTeamFile,
  resolveAgentStudioDir,
  safeStem,
  writeAgentFile,
  writeTeamFile,
  type AgentDirPaths,
} from './agent-file-store.ts'
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
  private readonly bindings: KvTable<string, SessionBinding>
  private readonly assignments: KvTable<string, { id: string; leadSessionId: string; teamId: string; memberName: string; profileId: string; createdAt: number }>
  private readonly dir: AgentDirPaths

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
    this.bindings = config.domain.table('bindings')
    this.assignments = config.domain.table('assignments')
    this.dir = resolveAgentStudioDir()
    this.configuredMax = config.maxMembers ?? 8
  }

  /** 载入目录真源 + 绑定缓存；旧 storage 数据一次性迁移成 md；seam 安装前必须 await。 */
  async ready(): Promise<void> {
    ensureAgentDirs(this.dir)
    await this.migrateLegacyStorage()
    this.reloadFromDisk()
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

  /** 旧版 storage（profiles/teams 表）→ md 文件的一次性迁移：仅当目录里还没有任何 md。 */
  private async migrateLegacyStorage(): Promise<void> {
    const legacyProfiles = this.domain.table('profiles')
    const legacyTeams = this.domain.table('teams')
    const hasFiles =
      (existsMd(this.dir.agents) || existsMd(this.dir.teams))
    if (hasFiles) return
    for (const profile of Array.from(legacyProfiles.entries(), ([, value]) => value)) {
      writeAgentFile(this.dir, profile)
    }
    for (const team of Array.from(legacyTeams.entries(), ([, value]) => value)) {
      writeTeamFile(this.dir, team)
    }
  }

  /** 每次读写入口都从目录重载：人和 agent 直接改文件即生效。 */
  private reloadFromDisk(): void {
    const { profiles, invalid } = readAgentProfilesSync(this.dir)
    this.profileCache.clear()
    for (const profile of profiles) this.profileCache.set(profile.id, profile)
    const { teams, invalid: invalidTeams } = readTeamsSync(this.dir)
    this.teamCache.clear()
    for (const team of teams) this.teamCache.set(team.id, team)
    if (invalid.length > 0 || invalidTeams.length > 0) {
      console.warn('[plugin-agent-studio] 无法解析的配置文件：', [...invalid, ...invalidTeams].join(', '))
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
    this.reloadFromDisk()
    return Array.from(this.profileCache.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveProfile(input: { profile: AgentProfile }): Promise<AgentProfile> {
    this.reloadFromDisk()
    const error = validateProfile(input.profile)
    if (error !== undefined) throw new Error(error)
    // id = 文件名（目录真源）；新建未给 id 时按 name 推导，撞名时顺延 -2/-3。
    const desired = input.profile.id.trim() === '' ? safeStem(input.profile.name) : safeStem(input.profile.id)
    let stem = desired
    let suffix = 2
    while (stem !== input.profile.id && this.profileCache.has(stem)) {
      stem = `${desired}-${suffix}`
      suffix += 1
    }
    const existing = this.profileCache.get(input.profile.id)
    const timestamp = now()
    const saved: AgentProfile = {
      ...input.profile,
      id: stem,
      maxDepth: Number.isInteger(input.profile.maxDepth) ? Math.min(8, Math.max(0, input.profile.maxDepth)) : 1,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    // 改名（id 变化）时移除旧文件，避免留下重复定义。
    if (input.profile.id.trim() !== '' && input.profile.id !== stem) removeAgentFile(this.dir, input.profile.id)
    writeAgentFile(this.dir, saved)
    this.reloadFromDisk()
    return this.profileCache.get(saved.id) ?? saved
  }

  async deleteProfile(id: string): Promise<boolean> {
    this.reloadFromDisk()
    removeAgentFile(this.dir, id)
    this.reloadFromDisk()
    return true
  }

  // ── teams ───────────────────────────────────────────────────────────

  listTeams(): TeamProfile[] {
    this.reloadFromDisk()
    return Array.from(this.teamCache.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveTeam(input: { team: TeamProfile }): Promise<TeamProfile> {
    this.reloadFromDisk()
    const error = validateTeam(input.team)
    if (error !== undefined) throw new Error(error)
    for (const ref of input.team.members) {
      if (!this.profileCache.has(ref.profileId)) throw new Error(`团队引用的智能体不存在：${ref.profileId}`)
    }
    const desired = input.team.id.trim() === '' ? safeStem(input.team.name) : safeStem(input.team.id)
    let stem = desired
    let suffix = 2
    while (stem !== input.team.id && this.teamCache.has(stem)) {
      stem = `${desired}-${suffix}`
      suffix += 1
    }
    const existing = this.teamCache.get(input.team.id)
    const timestamp = now()
    const saved: TeamProfile = {
      ...input.team,
      id: stem,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    if (input.team.id.trim() !== '' && input.team.id !== stem) removeTeamFile(this.dir, input.team.id)
    writeTeamFile(this.dir, saved)
    this.reloadFromDisk()
    return this.teamCache.get(saved.id) ?? saved
  }

  async deleteTeam(id: string): Promise<boolean> {
    this.reloadFromDisk()
    removeTeamFile(this.dir, id)
    this.reloadFromDisk()
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
    this.reloadFromDisk()
    return this.listProfiles().find((profile) => profile.name === name)
  }

  /** 团队成员是 profileId 引用；这里统一解析成当前智能体库的值。 */
  private resolveTeamMembers(team: TeamProfile, required: boolean): AgentProfile[] {
    const members: AgentProfile[] = []
    for (const ref of team.members) {
      const profile = this.profileCache.get(ref.profileId)
      if (profile === undefined) {
        if (required) throw new Error(`团队 ${team.name} 引用的智能体不存在：${ref.profileId}`)
        continue
      }
      members.push(profile)
    }
    return members
  }

  /** 供提示注入使用：解析团队当前引用的智能体；引用失效时跳过。 */
  teamMemberProfiles(teamId: string): AgentProfile[] {
    this.reloadFromDisk()
    const team = this.teamCache.get(teamId)
    if (team === undefined) return []
    return this.resolveTeamMembers(team, false)
  }

  resolveAssignmentProfile(leadId: string, memberName: string): AgentProfile | undefined {
    this.reloadFromDisk()
    const assignment = this.assignmentCache.get(leadId)?.get(memberName)
    if (assignment !== undefined) {
      // 团队成员只是引用；即使有 assignment 也读取当前 profile，保证编辑后生效。
      const direct = this.profileCache.get(assignment.profileId)
      if (direct !== undefined) return direct
    }

    // 没有显式 launch 时，模型可能直接按提示里的名字 spawn_teammate；
    // 从当前会话的绑定里找同名成员/单人 profile。
    const binding = this.bindingCache.get(leadId)
    if (binding?.mode === 'team' && binding.teamId !== undefined) {
      const team = this.teamCache.get(binding.teamId)
      if (team !== undefined) {
        return this.resolveTeamMembers(team, false).find((member) => member.name === memberName)
      }
    }
    if (binding?.mode === 'solo' && binding.profileId !== undefined) {
      const profile = this.profileCache.get(binding.profileId)
      if (profile?.name === memberName) return profile
    }
    return undefined
  }

  // ── launch ──────────────────────────────────────────────────────────

  async launchSolo(input: { sessionId: string; profileId: string; task: string }): Promise<{ childId: string }> {
    this.reloadFromDisk()
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
      signal: new AbortController().signal,
      request: {
        prompt: promptText(this.composePrompt(profile, input.task, 'solo')),
        parent: lead,
        ...(profile.presetId === undefined ? {} : { agentPreset: profile.presetId }),
        ...(model === undefined ? {} : { agentOptions: model }),
      },
    })
  }

  async launchTeam(input: LaunchInput): Promise<LaunchTeamResult> {
    this.reloadFromDisk()
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
    const teamMembers = this.resolveTeamMembers(team, true)
    if (existing.size + teamMembers.length > max) throw new Error(`团队人数超过上限 ${max}`)
    for (const member of teamMembers) {
      const error = validateMemberName(member.name)
      if (error !== undefined) throw new Error(`${member.name}：${error}`)
      if (existing.has(member.name)) throw new Error(`本会话已使用过名字 ${member.name}，请改名或新开会话`)
      if (member.context === 'fork' && member.presetId !== undefined) throw new Error(`${member.name}：fork 成员不支持独立 preset`)
    }

    const members: LaunchMemberResult[] = []
    const failed: LaunchMemberResult[] = []
    for (const member of teamMembers) {
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

      const task = input.memberTasks?.[member.name] ?? input.task
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

  async delegate(caller: RuntimeAgent, input: DelegateInput, signal?: AbortSignal): Promise<{ childId: string }> {
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
      signal: signal ?? new AbortController().signal,
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
