/**
 * usage-billing 远程通道（client → host，Typert Gateway 直连，不走会话）。
 *
 * **descriptor 由 remote-methods.ts 生成**，与 host 的 markRemoteMethods 同源 ——
 * 参数个数是硬契约（少传即运行时抛错），手写两份必然漂移，所以这里只做映射。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {
  InvocationDescriptor, RemoteResult, TypertCodec, TypertRemoteContribution, TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import { REMOTE_NAMESPACE, USAGE_BILLING_REMOTE_METHODS } from '../../remote-methods.ts'
import type {
  AliasInput, CustomPriceInput,
} from '../../types.ts'
import type { DailyPoint, ModelRow, Overview, SessionRow, WorkspaceRow } from '../../view.ts'
import type { PriceEntry } from '../../types.ts'
import type { RangeKind } from '../../time.ts'

export const USAGE_BILLING_REMOTE_PACKAGE = '@zzerx/dsh-plugin-usage-billing'

/** 宽松 codec：形状校验交给 host service（与 plugin-daily-log 同姿态）。 */
const loose: TypertCodec = {
  mode: 'strict', typeSymbol: 'json',
  create: () => ({ parse: (v: unknown) => v }),
  schema: { parse: (v: unknown) => v },
} as unknown as TypertCodec

const json: TypertCodec = { mode: 'src-json' }

export const usageBillingRemoteContribution: TypertRemoteContribution = {
  package: USAGE_BILLING_REMOTE_PACKAGE,
  descriptors: USAGE_BILLING_REMOTE_METHODS.map((spec): InvocationDescriptor => ({
    id: `${REMOTE_NAMESPACE}.${spec.method}`,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method: spec.method,
    invocation: { kind: 'direct' },
    parameters: spec.params.map((name) => ({ name, wire: name, source: 'json' as const, codec: loose })),
    result: json,
  })),
}

/* ---------- 类型增广：ctx.remote.usageBilling 有类型 ---------- */

/** host 名单里的方法名（唯一来源的类型投影）。 */
export type UsageBillingRemoteMethod = (typeof USAGE_BILLING_REMOTE_METHODS)[number]['method']

/**
 * 类型增广键的运行时清单，同时是类型层守卫：
 * `satisfies Record<UsageBillingRemoteMethod, true>` 要求与 host 名单**逐键相等**
 * （漏一个 → 缺键报错；多一个 → 多余属性报错），`UsageBillingAugmentedRemoteMap`
 * 又用它的键生成 `TypertRemoteMap` 的增广键。删掉 host 名单里的任一方法，
 * 这里与 tests/remote-contract.test.ts 会一起红 —— 手写类型面不再能悄悄漂移。
 */
export const USAGE_BILLING_REMOTE_AUGMENTATIONS = {
  overview: true,
  daily: true,
  byModel: true,
  bySession: true,
  byWorkspace: true,
  pricing: true,
  setCustomPrice: true,
  removeCustomPrice: true,
  refreshPricing: true,
  setAlias: true,
  aliasList: true,
  repricing: true,
  status: true,
} as const satisfies Record<UsageBillingRemoteMethod, true>

/** 由运行时清单推导的 `TypertRemoteMap` 增广（键与值都指向同一份手写类型面）。 */
export type UsageBillingAugmentedRemoteMap = {
  [K in keyof typeof USAGE_BILLING_REMOTE_AUGMENTATIONS as `${typeof REMOTE_NAMESPACE}/${K}`]: UsageBillingRemote[K]
}

export interface UsageBillingRemote {
  overview(rangeKind: RangeKind, includeSubagents: boolean): Promise<RemoteResult<{ overview: Overview; todayKey: string; budget: { enabled: boolean; monthlyCny: number } }>>
  daily(rangeKind: RangeKind, includeSubagents: boolean): Promise<RemoteResult<{ days: DailyPoint[] }>>
  byModel(rangeKind: RangeKind, includeSubagents: boolean): Promise<RemoteResult<{ models: ModelRow[] }>>
  bySession(rangeKind: RangeKind, includeSubagents: boolean): Promise<RemoteResult<{ sessions: SessionRow[] }>>
  byWorkspace(rangeKind: RangeKind, includeSubagents: boolean): Promise<RemoteResult<{ workspaces: WorkspaceRow[] }>>
  pricing(): Promise<RemoteResult<{ entries: Record<string, PriceEntry>; usdToCny: number; usdToCnySource: 'live' | 'default'; snapshotId: string }>>
  setCustomPrice(entry: CustomPriceInput): Promise<RemoteResult<{ ok: true }>>
  removeCustomPrice(key: string): Promise<RemoteResult<{ ok: boolean }>>
  refreshPricing(force: boolean): Promise<RemoteResult<{ ok: boolean; reason?: string; entries?: number; usdToCny?: number }>>
  setAlias(input: AliasInput): Promise<RemoteResult<{ ok: true }>>
  aliasList(): Promise<RemoteResult<{ aliases: Array<{ provider: string; rawModel: string; canonicalModel: string }> }>>
  repricing(): Promise<RemoteResult<{ changed: number }>>
  status(): Promise<RemoteResult<{ installAt: number; rows: number; sessions: number; snapshots: number }>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap extends UsageBillingAugmentedRemoteMap {}
  interface TypertRemoteNamespaceMap {
    usageBilling: TypertRemoteNamespace<'usageBilling'>
  }
}

export async function mountUsageBillingRemote(ctx: Context): Promise<() => Promise<void>> {
  return ctx.remote.$mount(usageBillingRemoteContribution)
}

export function usageBillingOf(ctx: Context): UsageBillingRemote {
  return (ctx.remote as ClientRemote & { usageBilling: UsageBillingRemote }).usageBilling
}
