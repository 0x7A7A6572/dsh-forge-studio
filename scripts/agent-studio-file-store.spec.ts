/** agent_studio.d 目录真源存取：md 解析/序列化/迁移口径。 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
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

function tmpPaths(): AgentDirPaths {
  const root = join(mkdtempSync(join(tmpdir(), 'agent-studio-store-')), 'agent_studio.d')
  return { root, agents: join(root, 'agents'), teams: join(root, 'teams') }
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
    const parsed = parseAgentMd('stem-id', serializeAgentMd(AGENT).replace('id 不存在', ''))
    expect(parsed?.name).toBe('前端架构师')
  })

  it('lists profiles from disk and skips unparsable files', () => {
    const paths = tmpPaths()
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

  it('resolves the directory from DSH_HOME and sanitizes stems', () => {
    expect(resolveAgentStudioDir({ DSH_HOME: 'X:/home' }, '/home/me').root).toBe(join('X:/home', 'agent_studio.d'))
    expect(resolveAgentStudioDir({}, '/home/me').root).toBe(join('/home/me', '.dsh', 'agent_studio.d'))
    expect(safeStem('a/b:c*.md')).toBe('a-b-c-.md')
    expect(safeStem('   ')).toBe('agent')
  })
})
