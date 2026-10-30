import { afterEach, describe, expect, it } from 'vitest'
import { installSeam, inspectSeam, resetSeamForTest } from '../packages/plugin-agent-studio/src/seam.ts'
import type { AgentProfile } from '../packages/plugin-agent-studio/src/types.ts'

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-reviewer',
    name: 'reviewer',
    displayName: 'Reviewer',
    description: 'Review code',
    rolePrompt: 'Be strict',
    defaultTask: 'review',
    presetId: 'preset-review',
    model: { provider: 'provider-a', model: 'model-a' },
    context: 'fresh',
    maxDepth: 1,
    avatarSeed: 'x',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

class FakeSubagents {
  last: any
  async startActivation(spec: any): Promise<{ childId: string }> {
    this.last = spec
    return { childId: 'child-1' }
  }
  getProvider(name: string): { capabilities: { agentPreset: boolean; agentOptions: boolean } } {
    return { capabilities: { agentPreset: name === 'spawn', agentOptions: true } }
  }
}

class FakeTeams {
  constructor(readonly sub: FakeSubagents) {}
  async spawnTeammate(caller: any, request: any): Promise<{ member: any }> {
    const started = await this.sub.startActivation({
      provider: 'spawn',
      request: { prompt: request.prompt, parent: caller },
    })
    return { member: { id: started.childId, name: request.name, role: 'teammate', status: 'running' } }
  }
}

function makeCtx(sub: FakeSubagents, teams: FakeTeams) {
  return {
    get(name: string) {
      if (name === 'subagents') return sub
      if (name === 'agentTeams') return teams
      return undefined
    },
  }
}

const lead = {
  id: 'lead-1',
  status: 'running',
  options: {},
  session: { header: {} },
}

afterEach(() => {
  resetSeamForTest()
})

describe('agent studio seam', () => {
  it('injects preset and model for a fresh teammate', async () => {
    const sub = new FakeSubagents()
    const teams = new FakeTeams(sub)
    const result = installSeam(makeCtx(sub, teams), {
      resolveProfile: (leadId, name) => leadId === 'lead-1' && name === 'reviewer' ? profile() : undefined,
    })
    expect(result.installed).toBe(true)
    expect(inspectSeam(makeCtx(sub, teams)).startMethod).toBe('startActivation')

    await teams.spawnTeammate(lead, {
      name: 'reviewer',
      description: 'review',
      prompt: [],
      context: 'fresh',
      provider: 'spawn',
      signal: new AbortController().signal,
    })

    expect(sub.last.request.agentPreset).toBe('preset-review')
    expect(sub.last.request.agentOptions).toEqual({ provider: 'provider-a', model: 'model-a' })
  })

  it('does not inject preset for fork but keeps model', async () => {
    const sub = new FakeSubagents()
    const teams = new FakeTeams(sub)
    installSeam(makeCtx(sub, teams), {
      resolveProfile: () => profile({ context: 'fork' }),
    })
    await teams.spawnTeammate(lead, {
      name: 'reviewer',
      description: 'review',
      prompt: [],
      context: 'fork',
      provider: 'spawn',
      signal: new AbortController().signal,
    })
    expect(sub.last.request.agentPreset).toBeUndefined()
    expect(sub.last.request.agentOptions).toEqual({ provider: 'provider-a', model: 'model-a' })
  })

  it('leaves unknown teammates untouched', async () => {
    const sub = new FakeSubagents()
    const teams = new FakeTeams(sub)
    installSeam(makeCtx(sub, teams), { resolveProfile: () => undefined })
    await teams.spawnTeammate(lead, {
      name: 'stranger',
      description: 'unknown',
      prompt: [],
      context: 'fresh',
      provider: 'spawn',
      signal: new AbortController().signal,
    })
    expect(sub.last.request.agentPreset).toBeUndefined()
    expect(sub.last.request.agentOptions).toBeUndefined()
  })

  it('restores the original methods on dispose', async () => {
    const sub = new FakeSubagents()
    const teams = new FakeTeams(sub)
    const seam = installSeam(makeCtx(sub, teams), { resolveProfile: () => profile() })
    seam.dispose()

    await teams.spawnTeammate(lead, {
      name: 'reviewer',
      description: 'review',
      prompt: [],
      context: 'fresh',
      provider: 'spawn',
      signal: new AbortController().signal,
    })
    expect(sub.last.request.agentPreset).toBeUndefined()
    expect(sub.last.request.agentOptions).toBeUndefined()
  })
})
