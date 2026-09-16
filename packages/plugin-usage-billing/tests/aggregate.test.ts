import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { aggregateOnce, resetAggregateCache } from '../src/aggregate.ts'
import type { AggregateDeps, SessionSource } from '../src/aggregate.ts'
import type { Diagnostic, FoldState, LedgerRow, PriceSnapshot } from '../src/types.ts'

function table<V>(): KvTable<string, V> {
  const map = new Map<string, V>()
  return {
    get: (k) => map.get(k), entries: () => map.entries(), keys: () => map.keys(),
    get size() { return map.size },
    put: async (k, v) => { map.set(k, v) }, delete: async (k) => map.delete(k),
    update: async (k, fn) => { const c = map.get(k); if (!c) throw new Error('missing-key'); const n = fn(c); map.set(k, n); return n },
  }
}

const SNAP: PriceSnapshot = {
  id: 'snap-1', at: 0, kind: 'base', reason: 'install', usdToCny: 7, usdToCnySource: 'default',
  entries: { 'deepseek/deepseek-v4-flash': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY' } },
}

const header = { version: 3, id: 's1', createdAt: 100, cwd: '/w', isSeeded: false } as unknown as SessionHeader
const ev = (type: string, seq: number, time: number, data: unknown) => ({ type, seq, time, data } as unknown as SessionEvent)
const usageEv = (seq: number) => ev('assistant/message', seq, 1_000 + seq, { usage: { inputTokens: 1_000_000, outputTokens: 0 } })
const routeEv = () => ev('request/context', 1, 1_000, { provider: 'deepseek', model: 'deepseek-v4-flash' })

function makeDeps(over: Partial<SessionSource> = {}, now = () => 1_000_000): {
  deps: AggregateDeps; ledger: KvTable<string, LedgerRow>; folds: KvTable<string, FoldState>
  diag: KvTable<string, Diagnostic>; reads: () => number
} {
  const ledger = table<LedgerRow>(); const folds = table<FoldState>()
  const diag = table<Diagnostic>(); const aliases = table<never>(); const snapshots = table<PriceSnapshot>()
  void snapshots.put(SNAP.id, SNAP)
  let readCount = 0
  const events = [routeEv(), usageEv(2)]
  const source: SessionSource = {
    listSessions: async () => [{ header }],
    listEvents: async () => events.map((e) => ({ seq: e.seq })),
    readSession: async () => { readCount += 1; return { session: header, events } },
    ...over,
  }
  const deps: AggregateDeps = {
    source, ledger, folds, diag, aliases,
    snapshots: snapshots as unknown as KvTable<string, PriceSnapshot>,
    installAt: 0, now, ttlMs: 5_000,
  }
  return { deps, ledger, folds, diag, reads: () => readCount }
}

beforeEach(() => { resetAggregateCache() })

describe('aggregateOnce', () => {
  it('首轮折叠并写账本与水位', async () => {
    const { deps, ledger, folds } = makeDeps()
    const stats = await aggregateOnce(deps)
    expect(stats).toMatchObject({ sessions: 1, folded: 1, skipped: 0, rows: 1, failures: 0 })
    expect(ledger.get('s1#2')!.costCny).toBe(1)
    expect(folds.get('s1')!.foldedThroughSeq).toBe(2)
  })

  it('maxSeq 未变时跳过 readSession（水位生效）', async () => {
    const { deps, reads } = makeDeps()
    await aggregateOnce(deps)
    const stats = await aggregateOnce(deps, { force: true })
    expect(reads()).toBe(1)
    expect(stats.folded).toBe(0)
    expect(stats.skipped).toBe(1)
  })

  it('重折不重复计费（行 id 幂等）', async () => {
    const { deps, ledger, folds } = makeDeps()
    await aggregateOnce(deps)
    // 清掉水位，否则第二次会被水位直接跳过、根本没重折（那样这个用例就什么也没证明）。
    await folds.delete('s1')
    const again = await aggregateOnce(deps, { force: true })
    expect(again.folded).toBe(1)
    expect(ledger.size).toBe(1)
    expect(ledger.get('s1#2')!.costCny).toBe(1)
  })

  it('TTL 内直接返回缓存结果（密集轮询合并）', async () => {
    const { deps, reads } = makeDeps()
    await aggregateOnce(deps)
    const stats = await aggregateOnce(deps)
    expect(stats.cached).toBe(true)
    expect(reads()).toBe(1)
  })

  it('readSession 抛错 → 记诊断、不推进水位、其余会话不受影响', async () => {
    const { deps, diag, folds } = makeDeps({
      readSession: async () => { throw new Error('corrupt') },
    })
    const stats = await aggregateOnce(deps)
    expect(stats.failures).toBe(1)
    expect([...diag.entries()][0]![1]).toMatchObject({ kind: 'session-read' })
    expect(folds.get('s1')).toBeUndefined()
  })

  it('未收录模型出现在 stats.unpricedModels', async () => {
    const { deps } = makeDeps({
      listEvents: async () => [{ seq: 2 }],
      readSession: async () => ({
        session: header,
        events: [ev('request/context', 1, 1_000, { provider: 'x', model: 'mystery' }), usageEv(2)],
      }),
    })
    expect((await aggregateOnce(deps)).unpricedModels).toEqual(['x/mystery'])
  })

  it('无价表快照时不崩（价格为 0 且 priced=false）', async () => {
    const { deps, ledger } = makeDeps()
    await (deps.snapshots as unknown as KvTable<string, PriceSnapshot>).delete('snap-1')
    await aggregateOnce(deps)
    expect(ledger.get('s1#2')).toMatchObject({ priced: false, costCny: 0 })
  })
})
