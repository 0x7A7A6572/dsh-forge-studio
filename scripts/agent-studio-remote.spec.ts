import { describe, expect, it } from 'vitest'
import { AGENT_STUDIO_REMOTE_PACKAGE, agentStudioRemoteContribution } from '../packages/plugin-agent-studio/src/client/core/remote.ts'
import { AgentStudioService } from '../packages/plugin-agent-studio/src/service.ts'

const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

describe('agent studio remote contract', () => {
  it('exposes the expected endpoint names', () => {
    expect(AGENT_STUDIO_REMOTE_PACKAGE).toBe('@zzerx/dsh-plugin-agent-studio')
    expect(agentStudioRemoteContribution.package).toBe(AGENT_STUDIO_REMOTE_PACKAGE)
    expect(agentStudioRemoteContribution.descriptors.map((descriptor) => descriptor.method)).toEqual([
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
  })

  it('uses the agentStudio namespace and service', () => {
    for (const descriptor of agentStudioRemoteContribution.descriptors) {
      expect(descriptor.namespace).toBe('agentStudio')
      expect(descriptor.service).toBe('agentStudio')
      expect(descriptor.id).toBe(`agentStudio.${descriptor.method}`)
    }
  })

  it('marks every descriptor method as a host remote method', () => {
    const marker = (AgentStudioService.prototype as unknown as Record<string, { methods: Array<{ method: string }> }>)[REMOTE_METHODS]
    expect(marker).toBeDefined()
    expect(marker.methods.map((entry) => entry.method).sort()).toEqual(
      agentStudioRemoteContribution.descriptors.map((descriptor) => descriptor.method).sort(),
    )
  })
})
