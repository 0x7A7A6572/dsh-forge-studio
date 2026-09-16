/** 联网价表与汇率（Task 14 填充真实实现）。 */
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { PriceSnapshot } from '../types.ts'
import type { PricingRefreshResult } from '../service.ts'

export interface PricingFetchDeps {
  web: { fetch(request: { url: string }, signal?: AbortSignal): Promise<{ url: string; statusCode: number; body: { kind: string; content: string }; truncated: boolean }> }
  snapshots: KvTable<string, PriceSnapshot>
  installAt: number
  now: () => number
}

export async function fetchPricingFromNetwork(_deps: PricingFetchDeps): Promise<PricingRefreshResult> {
  return { ok: false, reason: 'not implemented' }
}
