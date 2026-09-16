import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { UsageBillingService } from '../src/service.ts'
import { aggregateOnce } from '../src/aggregate.ts'
import type { AggregateDeps, SessionSource } from '../src/aggregate.ts'
import { USAGE_BILLING_METHOD_NAMES } from '../src/remote-methods.ts'
import { createUsageBillingSettingsAccess } from '../src/settings.ts'
import type { Diagnostic, FoldState, LedgerRow, ModelAlias, PriceEntry, PriceSnapshot } from '../src/types.ts'

function table<V>(): KvTable<string, V> {
  const map = new Map<string, V>()
  return {
    get: (k) => map.get(k), entries: () => map.entries(), keys: () => map.keys(),
    get size() { return map.size },
    put: async (k, v) => { map.set(k, v) }, delete: async (k) => map.delete(k),
    update: async (k, fn) => { const c = map.get(k); if (!c) throw new Error('missing-key'); const n = fn(c); map.set(k, n); return n },
  }
}

const SNAPSHOT: PriceSnapshot = {
  id: 'snap-1', at: 0, kind: 'base', reason: 'install', usdToCny: 7, usdToCnySource: 'default',
  entries: { 'deepseek/deepseek-v4-flash': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY' } },
}

const ROW: LedgerRow = {
  id: 's1#2', sessionId: 's1', seq: 2, time: 2_000, provider: 'deepseek', model: 'deepseek-v4-flash',
  day: '2026-09-16', cwd: '/w', isSubagent: false,
  input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0,
  costCny: 1, currency: 'CNY', priced: true, snapshotId: 'snap-1', backfilled: false,
}

function makeService() {
  const ledger = table<LedgerRow>(); const folds = table<FoldState>()
  const snapshots = table<PriceSnapshot>(); const aliases = table<ModelAlias>(); const diag = table<Diagnostic>()
  void snapshots.put(SNAPSHOT.id, SNAPSHOT)
  const domain = {
    table: (name: string) => ({ ledger, folds, snapshots, aliases, diag } as Record<string, unknown>)[name],
  } as never
  const settings = createUsageBillingSettingsAccess()
  const source: SessionSource = {
    listSessions: async () => [],
    listEvents: async () => [],
    readSession: async () => { throw new Error('unused') },
  }
  const svc = new UsageBillingService(new Context(), {
    domain,
    settings,
    installAt: 1_000,
    source,
    fetchPricing: async () => ({ ok: false, reason: 'not configured in test' }),
    now: () => 3_000,
  })
  return { svc, ledger, folds, snapshots, aliases, diag, source }
}

/** `ensureBaseSnapshot` 是私有方法（Task 14 才接线），用例按它声明的契约直接调用。 */
function writeBaseSnapshot(svc: UsageBillingService): void {
  const priv = svc as unknown as {
    ensureBaseSnapshot(entries: Record<string, PriceEntry>, usdToCny: number, src: 'live' | 'default'): void
  }
  priv.ensureBaseSnapshot({
    'deepseek/deepseek-v4-flash': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY' },
  }, 7, 'default')
}

describe('UsageBillingService', () => {
  it('标记的 Remote 方法名单与唯一来源一致', () => {
    const marked = (UsageBillingService.prototype as unknown as Record<string, { methods: Array<{ method: string }> }>)
      ['@deepseek-ai/dsh-typert-protocol/remote-methods']!
    expect(marked.methods.map((m) => m.method)).toEqual([...USAGE_BILLING_METHOD_NAMES])
  })

  it('status 报安装时刻与账本规模', async () => {
    const { svc } = makeService()
    expect(await svc.status()).toMatchObject({ installAt: 1_000, rows: 0 })
  })

  it('overview / daily / byModel 能吃账本（空库不崩）', async () => {
    const { svc } = makeService()
    expect(await svc.overview('7d', true)).toMatchObject({ overview: { totalCny: 0 } })
    // `daily` 返回**窗口形状**（buildDaily 会把窗口里每天补零），所以空账本是 7 个零点，不是 []。
    const empty = await svc.daily('7d', true)
    expect(empty.days).toHaveLength(7)
    expect(empty.days.every((d) => d.costCny === 0 && d.calls === 0)).toBe(true)
    expect(await svc.byModel('all', true)).toMatchObject({ models: [] })
  })

  it('pricing 返回当前生效价表与来源', async () => {
    const { svc } = makeService()
    const out = await svc.pricing()
    expect(out.usdToCny).toBe(7)
    expect(out.entries['deepseek/deepseek-v4-flash']).toBeDefined()
  })

  it('setCustomPrice 写入自定义价并追加 delta 快照', async () => {
    const { svc, snapshots } = makeService()
    await svc.setCustomPrice({ provider: 'deepseek', model: 'deepseek-v4-pro', currency: 'CNY', input: 1, cacheRead: 0, cacheWrite: 1, output: 2 })
    expect([...snapshots.entries()].map(([k]) => k)).toContain('snap-1#delta')
    expect((await svc.pricing()).entries['deepseek/deepseek-v4-pro']).toMatchObject({ input: 1, output: 2 })
  })

  it('removeCustomPrice 对没有自定义价的 key：报不成功且不追加快照', async () => {
    const { svc, snapshots } = makeService()
    // 该 key 既没有自定义价、也不在目录里 —— 删除必须是 no-op（不成功、不追加空 delta）。
    const out = await svc.removeCustomPrice('deepseek/no-such-model')
    expect(out).toMatchObject({ ok: false })
    expect([...snapshots.entries()]).toHaveLength(1) // 只有 snap-1，没有追加
  })

  it('setAlias / aliasList 往返', async () => {
    const { svc } = makeService()
    await svc.setAlias({ provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: 'deepseek-v4-flash' })
    expect((await svc.aliasList()).aliases).toHaveLength(1)
    await svc.setAlias({ provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: null })
    expect((await svc.aliasList()).aliases).toHaveLength(0)
  })

  it('repricing 只改未计价行', async () => {
    const { svc, ledger } = makeService()
    await ledger.put('a', { ...ROW, id: 'a', costCny: 0, priced: false, model: 'deepseek-v4-flash' })
    await ledger.put('b', { ...ROW, id: 'b', costCny: 99, priced: true })
    const out = await svc.repricing()
    expect(out).toMatchObject({ changed: 1 })
    expect(ledger.get('a')).toMatchObject({ priced: true, costCny: 1 })
    expect(ledger.get('b')!.costCny).toBe(99)
  })

  it('refreshPricing 失败时降级并给出原因（不抛）', async () => {
    const { svc } = makeService()
    expect(await svc.refreshPricing(true)).toMatchObject({ ok: false })
  })

  it('ensureBaseSnapshot 写基准快照后，下一次 aggregateOnce 不再吃缓存', async () => {
    const { svc, ledger, folds, diag, aliases, snapshots, source } = makeService()
    await snapshots.delete(SNAPSHOT.id) // 空价表账本：ensureBaseSnapshot 才会真的写
    const deps: AggregateDeps = {
      source, ledger, folds, diag, aliases, snapshots, installAt: 1_000, now: () => 3_000,
    }
    await aggregateOnce(deps)
    expect((await aggregateOnce(deps)).cached).toBe(true)

    writeBaseSnapshot(svc)

    expect(snapshots.size).toBe(1)
    expect((await aggregateOnce(deps)).cached).toBe(false)
  })
})
