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
import type { BudgetState } from '../../budget.ts'
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
  interface TypertRemoteMap {
    'usageBilling/overview': UsageBillingRemote['overview']
    'usageBilling/daily': UsageBillingRemote['daily']
    'usageBilling/byModel': UsageBillingRemote['byModel']
    'usageBilling/bySession': UsageBillingRemote['bySession']
    'usageBilling/byWorkspace': UsageBillingRemote['byWorkspace']
    'usageBilling/pricing': UsageBillingRemote['pricing']
    'usageBilling/setCustomPrice': UsageBillingRemote['setCustomPrice']
    'usageBilling/removeCustomPrice': UsageBillingRemote['removeCustomPrice']
    'usageBilling/refreshPricing': UsageBillingRemote['refreshPricing']
    'usageBilling/setAlias': UsageBillingRemote['setAlias']
    'usageBilling/aliasList': UsageBillingRemote['aliasList']
    'usageBilling/repricing': UsageBillingRemote['repricing']
    'usageBilling/status': UsageBillingRemote['status']
  }
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
