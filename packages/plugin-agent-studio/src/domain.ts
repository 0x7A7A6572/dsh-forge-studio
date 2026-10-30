/** Agent Studio 的持久化 domain 声明与纯领域校验。 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  AgentContextMode, AgentProfile, LaunchAssignment, ModelChoice, SessionBinding, TeamMode, TeamProfile,
} from './types.ts'

const modelChoiceSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
}) as unknown as z.ZodType<ModelChoice>

const agentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  rolePrompt: z.string(),
  defaultTask: z.string(),
  presetId: z.string().optional(),
  model: modelChoiceSchema.nullable(),
  context: z.enum(['fresh', 'fork']),
  maxDepth: z.number().int().min(0).max(8).default(1),
  avatarSeed: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
}) as unknown as z.ZodType<AgentProfile>

const teamProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  members: z.array(agentProfileSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
}) as unknown as z.ZodType<TeamProfile>

const sessionBindingSchema = z.object({
  sessionId: z.string(),
  mode: z.enum(['none', 'solo', 'team']),
  profileId: z.string().optional(),
  teamId: z.string().optional(),
  updatedAt: z.number(),
}) as unknown as z.ZodType<SessionBinding>

const launchAssignmentSchema = z.object({
  id: z.string(),
  leadSessionId: z.string(),
  teamId: z.string(),
  memberName: z.string(),
  profileId: z.string(),
  createdAt: z.number(),
}) as unknown as z.ZodType<LaunchAssignment>

export const agentStudioDomain = defineDomain({
  name: 'agent_studio',
  version: 1,
  layout: 'per-record',
  tables: {
    profiles: domainTable<string, AgentProfile>(agentProfileSchema),
    teams: domainTable<string, TeamProfile>(teamProfileSchema),
    bindings: domainTable<string, SessionBinding>(sessionBindingSchema),
    assignments: domainTable<string, LaunchAssignment>(launchAssignmentSchema),
  },
})

export const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
export const MAX_MEMBER_NAME = 64

export function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export function validateMemberName(name: string): string | undefined {
  if (name === 'lead') return '名字不能是 "lead"'
  if (name.length === 0) return '名字不能为空'
  if (name.length > MAX_MEMBER_NAME) return `名字不能超过 ${MAX_MEMBER_NAME} 个字符`
  if (!MEMBER_NAME.test(name)) return '名字只能是小写字母、数字和连字符（lower-kebab-case）'
  return undefined
}

export function validateProfile(profile: AgentProfile): string | undefined {
  if (profile.id.trim() === '') return 'profile id 不能为空'
  if (profile.displayName.trim() === '') return '显示名不能为空'
  return validateMemberName(profile.name)
}

export function validateTeam(team: TeamProfile): string | undefined {
  if (team.id.trim() === '') return 'team id 不能为空'
  if (team.name.trim() === '') return '团队名不能为空'
  if (team.members.length === 0) return '团队至少需要一个成员'
  const names = new Set<string>()
  for (const member of team.members) {
    const error = validateProfile(member)
    if (error !== undefined) return `${member.name || member.displayName || '成员'}：${error}`
    if (names.has(member.name)) return `成员名字重复：${member.name}`
    names.add(member.name)
  }
  return undefined
}

export function contextOf(value: string | undefined, fallback: AgentContextMode = 'fresh'): AgentContextMode {
  return value === 'fork' ? 'fork' : fallback
}

export function modeOf(value: string | undefined): TeamMode {
  return value === 'solo' || value === 'team' ? value : 'none'
}

/** 存储键必须匹配 per-record 后端的 SAFE_KEY_RE。 */
export function storageKey(...parts: string[]): string {
  return parts.join('__').replace(/[^a-zA-Z0-9_-]/g, '_')
}
