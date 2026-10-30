/** 官方 Team → subagent 的运行时 seam：注入成员的 preset / model。 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { AgentProfile } from './types.ts'
import { isRuntimeAgent, serviceOf, type AgentTeamsLike, type RuntimeAgent, type SpawnTeammateRequestLike, type SubagentsLike } from './runtime.ts'

export type StartMethod = 'startActivation' | 'startContinuable'

interface TeammateScope {
  leadId: string
  name: string
  context: 'fresh' | 'fork'
}

export interface SeamOptions {
  /** 根据 Lead 会话 + teammate 名字找 profile；找不到则原样放行。 */
  resolveProfile(leadId: string, memberName: string): AgentProfile | undefined
}

export interface SeamResult {
  installed: boolean
  startMethod: StartMethod | null
  dispose(): void
}

interface PatchRecord {
  installed: boolean
  restore(): void
}

function descriptorOf(target: object, method: string): PropertyDescriptor | undefined {
  let current: object | null = target
  for (let depth = 0; current !== null && depth < 8; depth += 1) {
    const own = Object.getOwnPropertyDescriptor(current, method)
    if (own !== undefined) return own
    current = Object.getPrototypeOf(current) as object | null
  }
  return undefined
}

function methodOf(target: object, method: string): ((...args: unknown[]) => unknown) | undefined {
  const descriptor = descriptorOf(target, method)
  return typeof descriptor?.value === 'function'
    ? descriptor.value as (...args: unknown[]) => unknown
    : undefined
}

/** 在实例/原型上换方法；用 descriptor 判断，避免 Cordis 服务代理的 get trap 假阴性。 */
function patchMethod(target: object, method: string, wrapper: (...args: any[]) => any): PatchRecord {
  const own = Object.getOwnPropertyDescriptor(target, method)
  try {
    Object.defineProperty(target, method, {
      value: wrapper,
      writable: true,
      configurable: true,
      enumerable: own?.enumerable ?? false,
    })
  } catch {
    return { installed: false, restore: () => {} }
  }
  return {
    installed: true,
    restore: () => {
      try {
        if (own === undefined) {
          delete (target as Record<string, unknown>)[method]
        } else {
          Object.defineProperty(target, method, own)
        }
      } catch {
        // 还原失败时原方法仍在闭包里；不影响后续重装。
      }
    },
  }
}

function patchBoth(instance: object, proto: object | null, method: string, makeWrapper: (original: (...args: any[]) => any) => (...args: any[]) => any): PatchRecord {
  const original = methodOf(instance, method)
  if (original === undefined) return { installed: false, restore: () => {} }
  const wrapper = makeWrapper(original)
  const records = [patchMethod(instance, method, wrapper)]
  if (proto !== null) records.push(patchMethod(proto, method, wrapper))
  return {
    installed: records.some((record) => record.installed),
    restore: () => {
      for (const record of records.reverse()) record.restore()
    },
  }
}

let activeDispose: (() => void) | null = null

export function installSeam(ctx: unknown, options: SeamOptions): SeamResult {
  if (activeDispose !== null) {
    return { installed: true, startMethod: null, dispose: activeDispose }
  }

  const subagents = serviceOf<SubagentsLike>(ctx, 'subagents')
  const agentTeams = serviceOf<AgentTeamsLike>(ctx, 'agentTeams')
  if (subagents === undefined || agentTeams === undefined) {
    return { installed: false, startMethod: null, dispose: () => {} }
  }

  const subProto = Object.getPrototypeOf(subagents) as object | null
  const teamProto = Object.getPrototypeOf(agentTeams) as object | null
  const startMethod: StartMethod | null = methodOf(subagents, 'startActivation') !== undefined
    ? 'startActivation'
    : methodOf(subagents, 'startContinuable') !== undefined
      ? 'startContinuable'
      : null
  if (startMethod === null) {
    return { installed: false, startMethod: null, dispose: () => {} }
  }
  if (methodOf(agentTeams, 'spawnTeammate') === undefined) {
    return { installed: false, startMethod, dispose: () => {} }
  }

  const scope = new AsyncLocalStorage<TeammateScope>()
  const restores: PatchRecord[] = []

  const spawnPatch = patchBoth(agentTeams, teamProto, 'spawnTeammate', original => function spawnTeammateWithScope(this: unknown, caller: unknown, request: SpawnTeammateRequestLike) {
    if (!isRuntimeAgent(caller)) return original.call(this, caller, request)
    const store: TeammateScope = {
      leadId: caller.id,
      name: request.name,
      context: request.context === 'fork' ? 'fork' : 'fresh',
    }
    return scope.run(store, () => original.call(this, caller, request))
  })
  restores.push(spawnPatch)

  const startPatch = patchBoth(subagents, subProto, startMethod, original => function startActivationWithComposition(this: unknown, spec: any) {
    const store = scope.getStore()
    if (store === undefined || spec === null || typeof spec !== 'object') {
      return original.call(this, spec)
    }
    const profile = options.resolveProfile(store.leadId, store.name)
    if (profile === undefined) return original.call(this, spec)

    const request = spec.request ?? {}
    const nextRequest: Record<string, unknown> = { ...request }
    if (profile.model !== null) {
      nextRequest.agentOptions = { ...(request.agentOptions ?? {}), ...profile.model }
    }
    if (store.context === 'fresh' && profile.presetId !== undefined && profile.presetId !== '') {
      const provider = subagents.getProvider?.(String(spec.provider))
      const supportsPreset = provider?.capabilities?.agentPreset !== false
      if (supportsPreset) nextRequest.agentPreset = profile.presetId
    }
    return original.call(this, { ...spec, request: nextRequest })
  })
  restores.push(startPatch)

  if (!spawnPatch.installed || !startPatch.installed) {
    for (const record of restores.reverse()) record.restore()
    return { installed: false, startMethod, dispose: () => {} }
  }

  const dispose = (): void => {
    for (const record of restores.reverse()) record.restore()
    activeDispose = null
  }
  activeDispose = dispose
  return { installed: true, startMethod, dispose }
}

/** 供测试/诊断：判断某个对象是否能被 seam 包装。 */
export function inspectSeam(ctx: unknown): { hasSubagents: boolean; hasAgentTeams: boolean; startMethod: StartMethod | null; hasSpawn: boolean } {
  const subagents = serviceOf<SubagentsLike>(ctx, 'subagents')
  const agentTeams = serviceOf<AgentTeamsLike>(ctx, 'agentTeams')
  const startMethod: StartMethod | null = subagents === undefined
    ? null
    : methodOf(subagents, 'startActivation') !== undefined
      ? 'startActivation'
      : methodOf(subagents, 'startContinuable') !== undefined
        ? 'startContinuable'
        : null
  return {
    hasSubagents: subagents !== undefined,
    hasAgentTeams: agentTeams !== undefined,
    startMethod,
    hasSpawn: agentTeams !== undefined && methodOf(agentTeams, 'spawnTeammate') !== undefined,
  }
}

/** 测试用：重置模块级安装状态。 */
export function resetSeamForTest(): void {
  activeDispose?.()
  activeDispose = null
}

export type { RuntimeAgent }
