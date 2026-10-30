/**
 * agentStudio 远程通道（client → host，Typert Gateway 直连，不走会话）：
 * host 侧 AgentStudioService 以 SRC 标记模式暴露 agentStudio/* 端点。
 *
 * 约束（两处必须与 host 一致）：
 * - 端点 method 名 = host 方法名；
 * - 参数 wire 名 = host 方法形参名（input / id / sessionId）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {
  InvocationDescriptor, RemoteResult, TypertCodec, TypertRemoteContribution, TypertRemoteNamespace, TypertSchema,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  AgentProfile, AgentStudioModelGroup, AgentStudioPresetRow, LaunchInput, LaunchTeamResult, SessionBinding,
  StudioCapabilities, StudioMemberRow, TeamProfile,
} from '../../types.ts'

export const AGENT_STUDIO_REMOTE_PACKAGE = '@zzerx/dsh-plugin-agent-studio'
const SERVICE = 'agentStudio'
const NAMESPACE = 'agentStudio'

function strict<T>(typeSymbol: string, schema: TypertSchema<T>): TypertCodec {
  return { mode: 'strict', typeSymbol, create: () => schema, schema } as unknown as TypertCodec
}

const json: TypertCodec = { mode: 'src-json' }

const stringCodec = strict<string>('string', {
  parse(value) {
    if (typeof value !== 'string') throw new Error('expected string')
    return value
  },
})

function loose<T>(typeSymbol: string): TypertCodec {
  return strict<T>(typeSymbol, {
    parse(value: unknown) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object')
      return value as T
    },
  })
}

function descriptor(method: string, parameters: InvocationDescriptor['parameters'] = []): InvocationDescriptor {
  return {
    id: NAMESPACE + '.' + method,
    service: SERVICE,
    namespace: NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: json,
  }
}

const inputParam = [{ name: 'input', wire: 'input', source: 'json' as const, codec: loose<unknown>('Input') }]
const idParam = [{ name: 'id', wire: 'id', source: 'json' as const, codec: stringCodec }]
const sessionIdParam = [{ name: 'sessionId', wire: 'sessionId', source: 'json' as const, codec: stringCodec }]

export const agentStudioRemoteContribution: TypertRemoteContribution = {
  package: AGENT_STUDIO_REMOTE_PACKAGE,
  descriptors: [
    descriptor('listProfiles'),
    descriptor('saveProfile', inputParam),
    descriptor('deleteProfile', idParam),
    descriptor('listTeams'),
    descriptor('saveTeam', inputParam),
    descriptor('deleteTeam', idParam),
    descriptor('listModels'),
    descriptor('listPresets'),
    descriptor('getCapabilities'),
    descriptor('getBinding', sessionIdParam),
    descriptor('setBinding', inputParam),
    descriptor('launch', inputParam),
    descriptor('listRoster', sessionIdParam),
  ],
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'agentStudio/listProfiles': () => Promise<RemoteResult<AgentProfile[]>>
    'agentStudio/saveProfile': (input: { profile: AgentProfile }) => Promise<RemoteResult<AgentProfile>>
    'agentStudio/deleteProfile': (id: string) => Promise<RemoteResult<boolean>>
    'agentStudio/listTeams': () => Promise<RemoteResult<TeamProfile[]>>
    'agentStudio/saveTeam': (input: { team: TeamProfile }) => Promise<RemoteResult<TeamProfile>>
    'agentStudio/deleteTeam': (id: string) => Promise<RemoteResult<boolean>>
    'agentStudio/listModels': () => Promise<RemoteResult<AgentStudioModelGroup[]>>
    'agentStudio/listPresets': () => Promise<RemoteResult<AgentStudioPresetRow[]>>
    'agentStudio/getCapabilities': () => Promise<RemoteResult<StudioCapabilities>>
    'agentStudio/getBinding': (sessionId: string) => Promise<RemoteResult<SessionBinding>>
    'agentStudio/setBinding': (input: { sessionId: string; mode: SessionBinding['mode']; profileId?: string; teamId?: string }) => Promise<RemoteResult<SessionBinding>>
    'agentStudio/launch': (input: LaunchInput) => Promise<RemoteResult<LaunchTeamResult | { childId: string }>>
    'agentStudio/listRoster': (sessionId: string) => Promise<RemoteResult<StudioMemberRow[]>>
  }
  interface TypertRemoteNamespaceMap {
    agentStudio: TypertRemoteNamespace<'agentStudio'>
  }
}

export interface AgentStudioRemote {
  listProfiles(): Promise<RemoteResult<AgentProfile[]>>
  saveProfile(input: { profile: AgentProfile }): Promise<RemoteResult<AgentProfile>>
  deleteProfile(id: string): Promise<RemoteResult<boolean>>
  listTeams(): Promise<RemoteResult<TeamProfile[]>>
  saveTeam(input: { team: TeamProfile }): Promise<RemoteResult<TeamProfile>>
  deleteTeam(id: string): Promise<RemoteResult<boolean>>
  listModels(): Promise<RemoteResult<AgentStudioModelGroup[]>>
  listPresets(): Promise<RemoteResult<AgentStudioPresetRow[]>>
  getCapabilities(): Promise<RemoteResult<StudioCapabilities>>
  getBinding(sessionId: string): Promise<RemoteResult<SessionBinding>>
  setBinding(input: { sessionId: string; mode: SessionBinding['mode']; profileId?: string; teamId?: string }): Promise<RemoteResult<SessionBinding>>
  launch(input: LaunchInput): Promise<RemoteResult<LaunchTeamResult | { childId: string }>>
  listRoster(sessionId: string): Promise<RemoteResult<StudioMemberRow[]>>
}

export async function mountAgentStudioRemote(ctx: Context): Promise<() => Promise<void>> {
  return ctx.remote.$mount(agentStudioRemoteContribution)
}

export function agentStudioOf(ctx: Context): AgentStudioRemote {
  return (ctx.remote as ClientRemote & { agentStudio: AgentStudioRemote }).agentStudio
}

export type { RemoteResult }
