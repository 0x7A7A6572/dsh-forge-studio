import { describe, expect, it } from 'vitest'
import { storageKey, validateMemberName, validateTeam } from '../packages/plugin-agent-studio/src/domain.ts'
import type { TeamMemberRef, TeamProfile } from '../packages/plugin-agent-studio/src/types.ts'

function member(profileId: string): TeamMemberRef {
  return { profileId }
}

function team(members: TeamMemberRef[]): TeamProfile {
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

  it('rejects duplicate profile references in a team', () => {
    expect(validateTeam(team([member('m1'), member('m1')]))).toContain('重复')
  })

  it('accepts a team with unique profile references', () => {
    expect(validateTeam(team([member('m1'), member('m2')]))).toBeUndefined()
  })

  it('produces path-safe storage keys', () => {
    expect(storageKey('session:1', 'team/2', 'member 3')).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})
