import { describe, expect, it } from 'vitest'
import { storageKey, validateMemberName, validateTeam } from '../packages/plugin-agent-studio/src/domain.ts'
import type { AgentProfile, TeamProfile } from '../packages/plugin-agent-studio/src/types.ts'

function member(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'm1',
    name: 'reviewer',
    displayName: 'Reviewer',
    description: '',
    rolePrompt: '',
    defaultTask: '',
    model: null,
    context: 'fresh',
    maxDepth: 1,
    avatarSeed: 'x',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function team(members: AgentProfile[]): TeamProfile {
  return { id: 't1', name: 'Team', description: '', members, createdAt: 0, updatedAt: 0 }
}

describe('agent studio domain', () => {
  it('accepts lower-kebab names and rejects invalid ones', () => {
    expect(validateMemberName('reviewer')).toBeUndefined()
    expect(validateMemberName('reviewer-2')).toBeUndefined()
    expect(validateMemberName('Reviewer')).toBeDefined()
    expect(validateMemberName('lead')).toBeDefined()
    expect(validateMemberName('')).toBeDefined()
  })

  it('rejects duplicate member names in a team', () => {
    expect(validateTeam(team([member(), member({ id: 'm2' })]))).toContain('重复')
  })

  it('accepts a team with unique members', () => {
    expect(validateTeam(team([member(), member({ id: 'm2', name: 'builder' })]))).toBeUndefined()
  })

  it('produces path-safe storage keys', () => {
    expect(storageKey('session:1', 'team/2', 'member 3')).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})
