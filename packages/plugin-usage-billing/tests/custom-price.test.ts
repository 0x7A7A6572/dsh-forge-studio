import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { UsageBillingService } from '../src/service.ts'
import { createUsageBillingSettingsAccess } from '../src/settings.ts'
import type { Diagnostic, FoldState, LedgerRow, ModelAlias, PriceSnapshot } from '../src/types.ts'

function table<V>(): KvTable<string, V> {
  const map = new Map<string, V>()
  return {
    get: (k) => map.get(k), entries: () => map.entries(), keys: () => map.keys(),
    get size() { return map.size },
    put: async (k, v) => { map.set(k, v) }, delete: async (k) => map.delete(k),
    update: async (k, fn) => { const c = map.get(k); if (!c) throw new Error('missing-key'); const n = fn(c); map.set(k, n); return n },
  }
}

function make() {
  const ledger = table<LedgerRow>(); const folds = table<FoldState>()
  const snapshots = table<PriceSnapshot>(); const aliases = table<ModelAlias>(); const diag = table<Diagnostic>()
  void snapshots.put('snap-0', {
    id: 'snap-0', at: 0, kind: 'base', reason: 'install', usdToCny: 7, usdToCnySource: 'default',
    entries: { 'deepseek/deepseek-v4-pro': { input: 2, cacheRead: 0, cacheWrite: 2, output: 8, currency: 'CNY' } },
  })
  const domain = { table: (n: string) => ({ ledger, folds, snapshots, aliases, diag } as Record<string, unknown>)[n] } as never
  const svc = new UsageBillingService(new Context(), {
    domain, settings: createUsageBillingSettingsAccess(), installAt: 0,
    source: { listSessions: async () => [], listEvents: async () => [], readSession: async () => { throw new Error('unused') } },
    fetchPricing: async () => ({ ok: false, reason: 'test' }),
    now: () => 5_000,
  })
  return { svc, ledger, snapshots, aliases }
}

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  id: 'x', sessionId: 's', seq: 1, time: 1_000, provider: 'deepseek', model: 'deepseek-v4-pro',
  day: '2026-09-16', isSubagent: false, input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0,
  reasoning: 0, costCny: 0, currency: 'CNY', priced: false, snapshotId: '', backfilled: false, ...over,
})

describe('自定义单价', () => {
  it('覆盖目录价且立即影响新折叠（不影响已锁定行）', async () => {
    const { svc, ledger } = make()
    await ledger.put('locked', row({ id: 'locked', costCny: 2, priced: true }))
    await svc.setCustomPrice({ provider: 'deepseek', model: 'deepseek-v4-pro', currency: 'CNY', input: 10, cacheRead: 0, cacheWrite: 10, output: 10 })
    expect((await svc.pricing()).entries['deepseek/deepseek-v4-pro']!.input).toBe(10)
    expect(ledger.get('locked')!.costCny).toBe(2)
  })

  it('provider 兜底 key（provider/*）可覆盖', async () => {
    const { svc } = make()
    await svc.setCustomPrice({ provider: 'relay', model: '*', currency: 'CNY', input: 1, cacheRead: 0, cacheWrite: 0, output: 1 })
    expect((await svc.pricing()).entries['relay/*']).toBeDefined()
  })

  it('全局兜底 key（*/*）可覆盖', async () => {
    const { svc } = make()
    await svc.setCustomPrice({ provider: '*', model: '*', currency: 'CNY', input: 1, cacheRead: 0, cacheWrite: 0, output: 1 })
    expect((await svc.pricing()).entries['*/*']).toBeDefined()
  })

  it('删除自定义价后回落到目录价', async () => {
    const { svc } = make()
    await svc.setCustomPrice({ provider: 'deepseek', model: 'deepseek-v4-pro', currency: 'CNY', input: 99, cacheRead: 0, cacheWrite: 0, output: 99 })
    await svc.removeCustomPrice('deepseek/deepseek-v4-pro')
    const e = (await svc.pricing()).entries['deepseek/deepseek-v4-pro']
    // 必须是「回落到目录价」，不是「删掉条目」——后者会把目录已收录的模型显示成未收录。
    expect(e?.input).toBe(2)
  })
})

describe('repricing', () => {
  it('只重算未计价行，已锁定行原封不动', async () => {
    const { svc, ledger } = make()
    await ledger.put('a', row({ id: 'a' }))
    await ledger.put('b', row({ id: 'b', costCny: 123, priced: true }))
    const out = await svc.repricing()
    expect(out.changed).toBe(1)
    expect(ledger.get('a')).toMatchObject({ priced: true, costCny: 2 })
    expect(ledger.get('b')!.costCny).toBe(123)
  })

  it('仍无价的未计价行保持未计价（不写 0 假价）', async () => {
    const { svc, ledger } = make()
    await ledger.put('c', row({ id: 'c', provider: 'x', model: 'mystery' }))
    expect((await svc.repricing()).changed).toBe(0)
    expect(ledger.get('c')!.priced).toBe(false)
  })
})
