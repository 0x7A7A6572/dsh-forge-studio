import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { aggregateOnce, resetAggregateCache } from '../src/aggregate.ts'
import type { AggregateDeps, SessionSource } from '../src/aggregate.ts'
import { MAX_DIAGNOSTICS, seenAt } from '../src/diag.ts'
import type { Diagnostic, FoldState, LedgerRow, PriceSnapshot } from '../src/types.ts'
import { fakeTable as table } from './fake-table.ts'

const SNAP: PriceSnapshot = {
  id: 'snap-1', at: 0, kind: 'base', reason: 'install', usdToCny: 7, usdToCnySource: 'default',
  entries: { 'deepseek/deepseek-v4-flash': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY' } },
}

const header = { version: 3, id: 's1', createdAt: 100, cwd: '/w', isSeeded: false } as unknown as SessionHeader
const ev = (type: string, seq: number, time: number, data: unknown) => ({ type, seq, time, data } as unknown as SessionEvent)
const usageEv = (seq: number) => ev('assistant/message', seq, 1_000 + seq, { usage: { inputTokens: 1_000_000, outputTokens: 0 } })
const routeEv = () => ev('request/context', 1, 1_000, { provider: 'deepseek', model: 'deepseek-v4-flash' })

/** 额外假会话：默认复用 s1 的事件序列，`fails` 让它的 readSession 抛错；列在 s1 **之前**。 */
interface ExtraSession { header: SessionHeader; events?: SessionEvent[]; fails?: boolean }

function makeDeps(
  over: Partial<SessionSource> = {},
  now = () => 1_000_000,
  extra: ExtraSession[] = [],
): {
  deps: AggregateDeps; ledger: KvTable<string, LedgerRow>; folds: KvTable<string, FoldState>
  diag: KvTable<string, Diagnostic>; reads: () => number
} {
  const ledger = table<LedgerRow>(); const folds = table<FoldState>()
  const diag = table<Diagnostic>(); const aliases = table<never>(); const snapshots = table<PriceSnapshot>()
  void snapshots.put(SNAP.id, SNAP)
  let readCount = 0
  const all = [
    ...extra.map((s) => ({
      header: s.header,
      events: s.events ?? [routeEv(), usageEv(2)],
      fails: s.fails ?? false,
    })),
    { header, events: [routeEv(), usageEv(2)], fails: false },
  ]
  const source: SessionSource = {
    listSessions: async () => all.map((s) => ({ header: s.header })),
    listEvents: async (id) => (all.find((s) => s.header.id === id)?.events ?? []).map((e) => ({ seq: e.seq })),
    readSession: async (id) => {
      readCount += 1
      const s = all.find((x) => x.header.id === id)!
      if (s.fails) throw new Error('corrupt')
      return { session: s.header, events: s.events }
    },
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
    expect(ledger.get('s1__2')!.costCny).toBe(1)
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
    expect(ledger.get('s1__2')!.costCny).toBe(1)
  })

  it('TTL 内直接返回缓存结果（密集轮询合并）', async () => {
    const { deps, reads } = makeDeps()
    await aggregateOnce(deps)
    const stats = await aggregateOnce(deps)
    expect(stats.cached).toBe(true)
    expect(reads()).toBe(1)
  })

  it('force: false 与不传等价（选项是布尔，不是三态）', async () => {
    const { deps, reads } = makeDeps()
    await aggregateOnce(deps)
    const stats = await aggregateOnce(deps, { force: false })
    expect(stats.cached).toBe(true)
    expect(reads()).toBe(1)
  })

  it('readSession 抛错 → 记诊断、不推进水位、其余会话不受影响', async () => {
    // 两个会话：s2 排在前面且 readSession 抛错，s1 干净 —— s2 的失败不能吃掉后面的 s1。
    const s2 = { ...header, id: 's2' } as unknown as SessionHeader
    const { deps, diag, folds, ledger } = makeDeps({}, () => 1_000_000, [{ header: s2, fails: true }])
    const stats = await aggregateOnce(deps)
    expect(stats).toMatchObject({ sessions: 2, folded: 1, rows: 1, failures: 1 })
    expect([...diag.entries()][0]![1]).toMatchObject({ kind: 'session-read' })
    expect(folds.get('s2')).toBeUndefined()
    // 干净会话照常折叠：水位推进 + 账本行落盘。
    expect(folds.get('s1')!.foldedThroughSeq).toBe(2)
    expect(ledger.get('s1__2')!.costCny).toBe(1)
  })

  it('seq 0 的会话首轮照折、次轮被水位跳过（种子 -1）', async () => {
    const { deps, ledger, folds } = makeDeps({
      listEvents: async () => [{ seq: 0 }],
      readSession: async () => ({ session: header, events: [usageEv(0)] }),
    })
    const first = await aggregateOnce(deps)
    expect(first).toMatchObject({ folded: 1, skipped: 0, failures: 0 })
    expect(folds.get('s1')!.foldedThroughSeq).toBe(0)
    // 单一事件会话没有归属事件，所以此行必然未计价 —— 关键是它真的落了账本。
    expect(ledger.get('s1__0')).toMatchObject({ seq: 0, priced: false })
    const second = await aggregateOnce(deps, { force: true })
    expect(second).toMatchObject({ folded: 0, skipped: 1, failures: 0 })
    expect(ledger.size).toBe(1)
  })

  it('无事件会话不抛错、不写账本（水位与 maxSeq 同为 -1）', async () => {
    const { deps, ledger, folds } = makeDeps({
      listEvents: async () => [],
      readSession: async () => ({ session: header, events: [] }),
    })
    const stats = await aggregateOnce(deps)
    expect(stats).toMatchObject({ sessions: 1, folded: 1, skipped: 0, rows: 0, failures: 0 })
    expect(folds.get('s1')!.foldedThroughSeq).toBe(-1)
    expect(ledger.size).toBe(0)
    const second = await aggregateOnce(deps, { force: true })
    expect(second).toMatchObject({ folded: 0, skipped: 1, failures: 0 })
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
    expect(ledger.get('s1__2')).toMatchObject({ priced: false, costCny: 0 })
  })
})

/**
 * 实测故障的另一半：183 个坏会话每轮都 `put('diag-<id>-<now()>')`，
 * 50 分钟涨到 3014 条、状态栏还要每次全表排序。这里钉住「重试不涨存储」。
 */
describe('诊断有界（重试风暴不涨存储）', () => {
  const badSessions = (count: number): ExtraSession[] =>
    Array.from({ length: count }, (_, i) => ({
      header: { ...header, id: `bad-${i}` } as unknown as SessionHeader,
      fails: true,
    }))

  /**
   * 越界规模：跟着上限走，但**封顶 200**。否则有人（或 bite-check）把 `MAX_DIAGNOSTICS`
   * 临时改大，这个用例会瞬间变成百万级压测而挂住 —— 用例本身不该是个陷阱。
   */
  const storm = Math.min(MAX_DIAGNOSTICS + 10, 200)

  it('同一坏会话反复失败：只有一条诊断，count 累加，失败照常上报', async () => {
    const { deps, diag } = makeDeps({}, () => 1_000_000, badSessions(1))
    expect((await aggregateOnce(deps, { force: true })).failures).toBe(1)
    expect((await aggregateOnce(deps, { force: true })).failures).toBe(1)
    // 两轮各失败一次，但键稳定于 (sessionId, kind)：条数不涨，只累加计数与最近时刻。
    expect(diag.size).toBe(1)
    const row = [...diag.entries()][0]![1]
    expect(row).toMatchObject({ id: 'diag__bad-0__session-read', count: 2, at: 1_000_000, lastAt: 1_000_000 })
  })

  it('坏会话数超过上限：整轮结束后 diag 回到上限之内', async () => {
    const { deps, diag } = makeDeps({}, () => 1_000_000, badSessions(storm))
    const stats = await aggregateOnce(deps, { force: true })
    expect(stats.failures).toBe(storm)
    expect(diag.size).toBe(MAX_DIAGNOSTICS)
  })

  it('旧版本堆下的超限诊断会被下一轮聚合清掉（这一轮没有任何失败也一样）', async () => {
    const { deps, diag } = makeDeps()
    for (let i = 0; i < storm; i += 1) {
      await diag.put(`diag__legacy-${i}__session-read`, {
        id: `diag__legacy-${i}__session-read`, at: i, lastAt: i, count: 1,
        kind: 'session-read', detail: 'legacy',
      })
    }
    const stats = await aggregateOnce(deps, { force: true })
    expect(stats.failures).toBe(0)
    expect(diag.size).toBe(MAX_DIAGNOSTICS)
    // 留的是最近的（lastAt 大的），最旧那几条被清掉。
    expect(diag.get('diag__legacy-0__session-read')).toBeUndefined()
    expect(diag.get(`diag__legacy-${storm - 1}__session-read`)).toBeDefined()
  })

  it('坏会话不被静默跳过：诊断带着它的 id 与原始错误，水位不推进', async () => {
    const { deps, diag, folds } = makeDeps({}, () => 1_000_000, badSessions(1))
    await aggregateOnce(deps, { force: true })
    const row = [...diag.entries()][0]![1]
    expect(row.detail).toContain('bad-0')
    expect(row.detail).toContain('corrupt')
    // 水位没推进 → 下轮仍会重试（这是有意的），但重试只累加计数。
    expect(folds.get('bad-0')).toBeUndefined()
    expect(seenAt(row)).toBe(1_000_000)
  })
})
