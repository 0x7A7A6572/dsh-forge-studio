/**
 * 目录真源存取：`<DSH_HOME>/agent_studio.d/{agents,teams}/<id>.md`。
 * 格式：frontmatter（key: value；含特殊字符的值用 JSON 字符串转义）+ 正文 = rolePrompt。
 * 没有 frontmatter 的文件整篇当 rolePrompt（手写最快路径）。
 * 文件名（去 .md）= profile/team id；frontmatter.name 缺省取文件名。
 * 全部同步 IO：service 的同步读路径（seam resolveProfile 等）也要"改文件即生效"。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile, TeamProfile } from './types.ts'

export interface AgentDirPaths {
  readonly root: string
  readonly agents: string
  readonly teams: string
}

/** 真源目录 = <DSH_HOME>/storages/agent_studio/（与 bindings 同域；md 为纯明文，可手编）。 */
export function resolveAgentStudioDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): AgentDirPaths {
  const configured = env.DSH_HOME?.trim() ?? ''
  const base = configured === '' ? join(home, '.dsh') : configured
  const root = join(base, 'storages', 'agent_studio')
  return { root, agents: join(root, 'agents'), teams: join(root, 'teams') }
}

/** 旧版根目录 agent_studio.d（v1 曾把 md 放在 DSH_HOME 根下）→ 一次性搬进 storages 域目录。 */
export function migrateLegacyRootDir(paths: AgentDirPaths, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): void {
  const configured = env.DSH_HOME?.trim() ?? ''
  const base = configured === '' ? join(home, '.dsh') : configured
  const legacy = join(base, 'agent_studio.d')
  for (const [from, to] of [
    [join(legacy, 'agents'), paths.agents],
    [join(legacy, 'teams'), paths.teams],
  ] as const) {
    if (!existsSync(from)) continue
    for (const name of readdirSync(from)) {
      if (!name.endsWith('.md')) continue
      const target = join(to, name)
      if (existsSync(target)) continue
      writeFileSync(target, readFileSync(join(from, name)))
    }
  }
}

export function ensureAgentDirs(paths: AgentDirPaths): void {
  mkdirSync(paths.agents, { recursive: true })
  mkdirSync(paths.teams, { recursive: true })
}

/** 文件名安全化：Windows 保留字符/控制符 → '-'、空白折叠为 '-'、去首尾连字符；空结果兜底 'agent'。 */
const BAD_STEM_CHARS = '<>:"/\\|?*'

export function safeStem(id: string): string {
  const stem = id
    .split('')
    .map((ch) => (BAD_STEM_CHARS.includes(ch) || (ch >= '\x00' && ch <= '\x1f') ? '-' : ch))
    .join('')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/-+$/, '')
    .trim()
  return stem === '' ? 'agent' : stem
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/

function scalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function encodeScalar(value: string): string {
  return /["\n\r]|:\s|^\s|\s$/.test(value) ? JSON.stringify(value) : value
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = FRONTMATTER_RE.exec(raw)
  if (match === null) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (key !== '') meta[key] = scalar(line.slice(idx + 1))
  }
  return { meta, body: match[2] }
}

export function parseAgentMd(stem: string, raw: string): AgentProfile | undefined {
  const { meta, body } = parseFrontmatter(raw)
  const name = meta.name ?? stem
  if (name === '') return undefined
  const timestamp = num(meta.createdAt) ?? num(meta.updatedAt) ?? Date.now()
  const hasModel = (meta.modelProvider ?? '') !== '' && (meta.model ?? '') !== ''
  const maxTokens = num(meta.maxTokens)
  return {
    id: stem,
    name,
    displayName: (meta.displayName ?? '') === '' ? name : scalar(meta.displayName),
    description: meta.description ?? '',
    rolePrompt: body.trim(),
    ...(meta.presetId !== undefined && meta.presetId !== '' ? { presetId: meta.presetId } : {}),
    model: hasModel
      ? {
          provider: meta.modelProvider!,
          model: meta.model!,
          ...(meta.reasoningEffort !== undefined && meta.reasoningEffort !== ''
            ? { reasoningEffort: meta.reasoningEffort }
            : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
        }
      : null,
    context: meta.context === 'fork' ? 'fork' : 'fresh',
    maxDepth: num(meta.maxDepth) ?? 1,
    ...(num(meta.color) !== undefined ? { avatarColor: num(meta.color)! } : {}),
    createdAt: timestamp,
    updatedAt: num(meta.updatedAt) ?? timestamp,
  }
}

export function serializeAgentMd(profile: AgentProfile): string {
  const lines = ['---', `name: ${encodeScalar(profile.name)}`]
  if (profile.displayName !== profile.name) lines.push(`displayName: ${encodeScalar(profile.displayName)}`)
  if (profile.description !== '') lines.push(`description: ${encodeScalar(profile.description)}`)
  if (profile.model !== null) {
    lines.push(`modelProvider: ${encodeScalar(profile.model.provider)}`)
    lines.push(`model: ${encodeScalar(profile.model.model)}`)
    if (profile.model.reasoningEffort !== undefined) lines.push(`reasoningEffort: ${encodeScalar(profile.model.reasoningEffort)}`)
    if (profile.model.maxTokens !== undefined) lines.push(`maxTokens: ${profile.model.maxTokens}`)
  }
  lines.push(`context: ${profile.context}`)
  lines.push(`maxDepth: ${profile.maxDepth}`)
  if (profile.avatarColor !== undefined) lines.push(`color: ${profile.avatarColor}`)
  if (profile.presetId !== undefined) lines.push(`presetId: ${encodeScalar(profile.presetId)}`)
  lines.push(`createdAt: ${profile.createdAt}`)
  lines.push(`updatedAt: ${profile.updatedAt}`)
  lines.push('---', '', profile.rolePrompt.trim(), '')
  return lines.join('\n')
}

export function parseTeamMd(stem: string, raw: string): TeamProfile | undefined {
  const { meta } = parseFrontmatter(raw)
  const name = meta.name ?? stem
  if (name === '') return undefined
  const members = (meta.members ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
    .map((profileId) => ({ profileId }))
  const timestamp = num(meta.createdAt) ?? num(meta.updatedAt) ?? Date.now()
  return {
    id: stem,
    name,
    description: meta.description ?? '',
    members,
    createdAt: timestamp,
    updatedAt: num(meta.updatedAt) ?? timestamp,
  }
}

export function serializeTeamMd(team: TeamProfile): string {
  const lines = [
    '---',
    `name: ${encodeScalar(team.name)}`,
    ...(team.description !== '' ? [`description: ${encodeScalar(team.description)}`] : []),
    `members: ${team.members.map((member) => member.profileId).join(', ')}`,
    `createdAt: ${team.createdAt}`,
    `updatedAt: ${team.updatedAt}`,
    '---',
    '',
  ]
  return lines.join('\n')
}

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
}

export function existsMd(dir: string): boolean {
  return listMdFiles(dir).length > 0
}

export function readAgentProfilesSync(paths: AgentDirPaths): { profiles: AgentProfile[]; invalid: string[] } {
  const profiles: AgentProfile[] = []
  const invalid: string[] = []
  for (const name of listMdFiles(paths.agents)) {
    const stem = name.slice(0, -3)
    try {
      const profile = parseAgentMd(stem, readFileSync(join(paths.agents, name), 'utf8'))
      if (profile === undefined) invalid.push(name)
      else profiles.push(profile)
    } catch {
      invalid.push(name)
    }
  }
  return { profiles, invalid }
}

export function readTeamsSync(paths: AgentDirPaths): { teams: TeamProfile[]; invalid: string[] } {
  const teams: TeamProfile[] = []
  const invalid: string[] = []
  for (const name of listMdFiles(paths.teams)) {
    const stem = name.slice(0, -3)
    try {
      const team = parseTeamMd(stem, readFileSync(join(paths.teams, name), 'utf8'))
      if (team === undefined) invalid.push(name)
      else teams.push(team)
    } catch {
      invalid.push(name)
    }
  }
  return { teams, invalid }
}

export function writeAgentFile(paths: AgentDirPaths, profile: AgentProfile): void {
  mkdirSync(paths.agents, { recursive: true })
  writeFileSync(join(paths.agents, `${safeStem(profile.id)}.md`), serializeAgentMd(profile), 'utf8')
}

export function writeTeamFile(paths: AgentDirPaths, team: TeamProfile): void {
  mkdirSync(paths.teams, { recursive: true })
  writeFileSync(join(paths.teams, `${safeStem(team.id)}.md`), serializeTeamMd(team), 'utf8')
}

export function removeAgentFile(paths: AgentDirPaths, id: string): void {
  rmSync(join(paths.agents, `${safeStem(id)}.md`), { force: true })
}

export function removeTeamFile(paths: AgentDirPaths, id: string): void {
  rmSync(join(paths.teams, `${safeStem(id)}.md`), { force: true })
}
