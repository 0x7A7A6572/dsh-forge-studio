/** agent_studio.d 目录真源存取：md 解析/序列化/迁移口径。 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  migrateLegacyAgentDirs,
  migrateLegacyKvRecords,
  parseAgentMd,
  parseTeamMd,
  readAgentProfilesSync,
  resolveAgentStudioDir,
  safeStem,
  serializeAgentMd,
  serializeTeamMd,
  writeAgentFile,
  type AgentDirPaths,
} from '../packages/plugin-agent-studio/src/agent-file-store.ts'

const AGENT: import('../packages/plugin-agent-studio/src/types.ts').AgentProfile = {
  id: 'frontend-architect',
  name: '前端架构师',
  displayName: '架构师',
  description: '负责前端方案评审',
  rolePrompt: '你是前端架构师。\n\n负责方案评审与拆解。',
  model: { provider: 'workbuddy', model: 'glm-5.3-flash', reasoningEffort: 'high' },
  context: 'fork',
  maxDepth: 2,
  avatarColor: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
}

/** 临时 DSH_HOME → 经 resolveAgentStudioDir 构造域目录（与生产同口径）。 */
function tmpHome(): { home: string; paths: AgentDirPaths } {
  const home = mkdtempSync(join(tmpdir(), 'agent-studio-store-'))
  return { home, paths: resolveAgentStudioDir({ DSH_HOME: home }, home) }
}

describe('agent studio file store', () => {
  it('serializes and parses an agent md round-trip', () => {
    const raw = serializeAgentMd(AGENT)
    // 文件名 = id：序列化里不写 id 字段。
    expect(raw).not.toMatch(/^id:/m)
    const parsed = parseAgentMd(AGENT.id, raw)
    expect(parsed).toEqual(AGENT)
  })

  it('treats a frontmatter-less file as rolePrompt with stem as name', () => {
    const parsed = parseAgentMd('quick-reviewer', '直接帮忙做代码评审。')
    expect(parsed?.name).toBe('quick-reviewer')
    expect(parsed?.displayName).toBe('quick-reviewer')
    expect(parsed?.rolePrompt).toBe('直接帮忙做代码评审。')
    expect(parsed?.model).toBeNull()
    expect(parsed?.context).toBe('fresh')
  })

  it('prefers frontmatter name over the file stem', () => {
    const parsed = parseAgentMd('stem-id', serializeAgentMd(AGENT))
    expect(parsed?.name).toBe('前端架构师')
  })

  it('lists profiles from disk and skips unparsable files', () => {
    const { paths } = tmpHome()
    writeAgentFile(paths, AGENT)
    writeFileSync(join(paths.agents, 'broken.md'), '---\nname: ""\n---\n\n空名字')
    const { profiles, invalid } = readAgentProfilesSync(paths)
    expect(profiles.map((profile) => profile.id)).toEqual(['frontend-architect'])
    expect(invalid).toEqual(['broken.md'])
  })

  it('round-trips teams with member id lists', () => {
    const team: import('../packages/plugin-agent-studio/src/types.ts').TeamProfile = {
      id: 'frontend-squad',
      name: '前端小队',
      description: '',
      members: [{ profileId: 'frontend-architect' }, { profileId: 'frontend-implementer' }],
      createdAt: 1,
      updatedAt: 2,
    }
    const parsed = parseTeamMd(team.id, serializeTeamMd(team))
    expect(parsed).toEqual(team)
  })

  it('resolves the directory under storages/<domain> and sanitizes stems', () => {
    expect(resolveAgentStudioDir({ DSH_HOME: 'X:/home' }, '/home/me').root).toBe(
      join('X:/home', 'storages', 'dsh_forge_studio_agent_studio'),
    )
    expect(resolveAgentStudioDir({}, '/home/me').root).toBe(
      join('/home/me', '.dsh', 'storages', 'dsh_forge_studio_agent_studio'),
    )
    expect(safeStem('a/b:c*.md')).toBe('a-b-c-.md')
    expect(safeStem('   ')).toBe('agent')
  })

  it('migrates md files from every legacy layout into the domain dir', () => {
    const { home, paths } = tmpHome()
    for (const dir of [
      join(home, 'agent_studio.d', 'agents'),
      join(home, 'storages', 'agent_studio', 'agents'),
    ]) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'legacy.md'), '---\nname: 旧档案\n---\n\n旧内容', 'utf8')
    }
    migrateLegacyAgentDirs(paths, { DSH_HOME: home })
    const { profiles } = readAgentProfilesSync(paths)
    expect(profiles.map((profile) => profile.id)).toEqual(['legacy'])
    expect(profiles[0].rolePrompt).toBe('旧内容')
  })

  it('copies legacy KV records (bindings/assignments) into the new domain dir', () => {
    const { home, paths } = tmpHome()
    const legacyBindings = join(home, 'storages', 'agent_studio', 'bindings')
    mkdirSync(legacyBindings, { recursive: true })
    writeFileSync(join(legacyBindings, 'session-1.json'), '{"sessionId":"session-1","mode":"none","updatedAt":0}', 'utf8')
    migrateLegacyKvRecords(paths, { DSH_HOME: home })
    expect(readFileSync(join(paths.bindings, 'session-1.json'), 'utf8')).toContain('session-1')
  })
})
