/**
 * Remote 方法的**唯一来源**：host 的 markRemoteMethods 与 client 的 descriptors 都读这里。
 *
 * 存在的理由（spec 承重事实 12）：client 的参数个数是硬契约，声明几个就必须传几个，
 * 少传会在运行时抛 `expected N argument(s), got M`。两侧各写一份必然漂移，
 * 所以名单只写一次，并用 tests/service-remote.test.ts 钉住。
 */

export const REMOTE_NAMESPACE = 'usageBilling'

export interface RemoteMethodSpec {
  method: string
  /** 形参名，顺序即 wire 顺序。 */
  params: readonly string[]
}

export const USAGE_BILLING_REMOTE_METHODS: readonly RemoteMethodSpec[] = Object.freeze([
  { method: 'overview', params: ['rangeKind', 'includeSubagents'] },
  { method: 'daily', params: ['rangeKind', 'includeSubagents'] },
  { method: 'byModel', params: ['rangeKind', 'includeSubagents'] },
  { method: 'bySession', params: ['rangeKind', 'includeSubagents'] },
  { method: 'byWorkspace', params: ['rangeKind', 'includeSubagents'] },
  { method: 'pricing', params: [] },
  { method: 'setCustomPrice', params: ['entry'] },
  { method: 'removeCustomPrice', params: ['key'] },
  { method: 'refreshPricing', params: ['force'] },
  { method: 'setAlias', params: ['input'] },
  { method: 'aliasList', params: [] },
  { method: 'repricing', params: [] },
  { method: 'status', params: [] },
])

export const USAGE_BILLING_METHOD_NAMES: readonly string[] =
  USAGE_BILLING_REMOTE_METHODS.map((m) => m.method)
