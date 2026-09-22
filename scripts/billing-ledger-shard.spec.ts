/**
 * 账本分片的幂等门禁（任务 D）。
 *
 * 背景：账本从「一行一个文件、存储键天然唯一」迁到「会话×天一个分片、分片内按行 id 唯一」，
 * 幂等不再由存储键保证（键变成了共享容器），必须由这里的不变量守住：
 * 重复折叠不得增行、同 seq 覆盖、跨分片不得留旧副本、批内顺序不得影响结果、并发写入不得丢行；
 * 换容器的那一趟（rebuild）还得忽略水位、可重跑、失败不落水位。
 */
import { describe, expect, it } from 'vitest'
import { aggregateOnce } from '../packages/plugin-usage-billing/src/aggregate.ts'
import type { AggregateDeps, SessionSource } from '../packages/plugin-usage-billing/src/aggregate.ts'
import { LedgerStore } from '../packages/plugin-usage-billing/src/ledger-store.ts'
import { emptyShard, mergeShardRows, sameRow } from '../packages/plugin-usage-billing/src/shard-merge.ts'
import {
  SAFE_KEY_RE, decodeStorageKey, foldKey, ledgerKey, ledgerShardKey,
} from '../packages/plugin-usage-billing/src/storage-key.ts'
import type {
  Diagnostic, FoldState, LedgerRow, LedgerShard, ModelAlias, PriceSnapshot,
} from '../packages/plugin-usage-billing/src/types.ts'

const SID = 'session-79805730-a288-4251-b3d3-8afa82b1b769'
const DAY = '2026-09-21'

function row(sessionId: string, seq: number, over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: ledgerKey(sessionId, seq),
    sessionId,
    seq,
    time: 1_789_000_000_000,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    day: DAY,
    isSubagent: false,
    input: 100,
    cacheRead: 0,
    cacheWrite: 0,
    output: 10,
    reasoning: 0,
    costCny: 0.01,
    currency: 'CNY',
    priced: true,
    snapshotId: 'snap-install',
    backfilled: false,
    ...over,
  }
}

/** 与 storage-domain 的 KvTable 同形的假表；计数写入次数，好让「没变就不写」能被举证。 */
function fakeKv<V>(): { table: unknown; raw: Map<string, V>; writes: () => number } {
  const raw = new Map<string, V>()
  let writes = 0
  return {
    raw,
    writes: () => writes,
    table: {
      get: (key: string) => raw.get(key),
      entries: () => raw.entries(),
      keys: () => raw.keys(),
      get size() { return raw.size },
      put: async (key: string, value: V) => { writes += 1; raw.set(key, value) },
      delete: async (key: string) => { writes += 1; return raw.delete(key) },
      update: async (key: string, fn: (current: V) => V) => {
        const current = raw.get(key)
        if (current === undefined) throw new Error('missing-key')
        const next = fn(current)
        writes += 1
        raw.set(key, next)
        return next
      },
    },
  }
}

const store = (table: unknown): LedgerStore => new LedgerStore(table as never)

describe('分片键（会话×天）', () => {
  it('路径安全且可逆，末段就是天', () => {
    const key = ledgerShardKey(SID, DAY)
    expect(SAFE_KEY_RE.test(key)).toBe(true)
    expect(decodeStorageKey(key)).toEqual([SID, DAY])
    expect(key.endsWith('__' + DAY)).toBe(true)
  })

  it('行身份不变：仍是 ledgerKey(sessionId, seq)', () => {
    expect(ledgerKey(SID, 42)).toBe(SID + '__42')
    expect(ledgerShardKey(SID, DAY)).not.toBe(ledgerKey(SID, 42))
  })
})

describe('mergeShardRows：幂等内核', () => {
  it('同一批并入两次，第二次不算变化', () => {
    const batch = [row(SID, 1), row(SID, 2), row(SID, 3)]
    const first = mergeShardRows([], batch)
    expect(first.changed).toBe(true)
    expect(first.rows).toHaveLength(3)
    const second = mergeShardRows(first.rows, batch)
    expect(second.changed).toBe(false)
    expect(second.rows).toHaveLength(3)
  })

  it('同 seq 覆盖（repricing 通道），不新增行', () => {
    const current = mergeShardRows([], [row(SID, 7)]).rows
    const merged = mergeShardRows(current, [row(SID, 7, { costCny: 0.99, priced: true })])
    expect(merged.changed).toBe(true)
    expect(merged.rows).toHaveLength(1)
    expect(merged.rows[0]!.costCny).toBe(0.99)
  })

  it('批内顺序不影响结果：按 seq 升序且字节稳定', () => {
    const a = mergeShardRows([], [row(SID, 3), row(SID, 1), row(SID, 2)])
    const b = mergeShardRows([], [row(SID, 2), row(SID, 1), row(SID, 3)])
    expect(a.rows.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(JSON.stringify(emptyShard(SID, DAY, a.rows))).toBe(JSON.stringify(emptyShard(SID, DAY, b.rows)))
  })

  it('sameRow 认得出内容变化', () => {
    expect(sameRow(row(SID, 1), row(SID, 1))).toBe(true)
    expect(sameRow(row(SID, 1), row(SID, 1, { costCny: 2 }))).toBe(false)
    expect(sameRow(row(SID, 1), row(SID, 1, { cwd: 'D:\\work' }))).toBe(false)
  })
})

describe('LedgerStore：写入路径', () => {
  it('同一行重复 put 只落一次盘', async () => {
    const f = fakeKv<LedgerShard>()
    const s = store(f.table)
    await s.put(row(SID, 1).id, row(SID, 1))
    const after = f.writes()
    await s.put(row(SID, 1).id, row(SID, 1))
    expect(after).toBe(1)
    expect(f.writes()).toBe(1)
    expect(s.size).toBe(1)
  })

  it('按 (会话, 天) 落到同一个分片，键就是 ledgerShardKey', async () => {
    const f = fakeKv<LedgerShard>()
    const s = store(f.table)
    for (const seq of [1, 2, 3]) await s.put(row(SID, seq).id, row(SID, seq))
    expect(s.shardCount).toBe(1)
    expect(f.raw.get(ledgerShardKey(SID, DAY))!.rows.map((r) => r.seq)).toEqual([1, 2, 3])
  })

  it('换天重写同一 seq：旧分片不留副本，全账本仍唯一（I1）', async () => {
    const f = fakeKv<LedgerShard>()
    const s = store(f.table)
    const nextDay = row(SID, 5, { day: '2026-09-22' })
    await s.put(row(SID, 5).id, row(SID, 5))
    expect(f.raw.get(ledgerShardKey(SID, DAY))!.rows).toHaveLength(1)
    await s.put(nextDay.id, nextDay)
    expect(f.raw.has(ledgerShardKey(SID, DAY))).toBe(false)
    expect(f.raw.get(ledgerShardKey(SID, '2026-09-22'))!.rows).toHaveLength(1)
    expect(s.size).toBe(1)
    expect(s.get(nextDay.id)!.day).toBe('2026-09-22')
  })

  it('并发 put 不丢行（串行链）', async () => {
    const f = fakeKv<LedgerShard>()
    const s = store(f.table)
    const rows = Array.from({ length: 50 }, (_, i) => row(SID, i + 1))
    await Promise.all(rows.map((r) => s.put(r.id, r)))
    expect(s.size).toBe(50)
    expect(f.raw.get(ledgerShardKey(SID, DAY))!.rows).toHaveLength(50)
    expect(s.all().map((r) => r.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  })

  it('成批写：一个会话的行只落一次盘', async () => {
    const f = fakeKv<LedgerShard>()
    const s = store(f.table)
    await s.putMany(Array.from({ length: 7 }, (_, i) => row(SID, i + 1)))
    expect(f.writes()).toBe(1)
    expect(s.size).toBe(7)
  })

  it('成批写里全是旧行时不写盘', async () => {
    const f = fakeKv<LedgerShard>()
    const s = store(f.table)
    const rows = [row(SID, 1), row(SID, 2)]
    await s.putMany(rows)
    const before = f.writes()
    await s.putMany(rows)
    expect(f.writes()).toBe(before)
  })

  it('成批跨天：两片各写一次', async () => {
    const f = fakeKv<LedgerShard>()
    const s = store(f.table)
    await s.putMany([row(SID, 1), row(SID, 2, { day: '2026-09-22' })])
    expect(f.writes()).toBe(2)
    expect(s.shardCount).toBe(2)
  })

  it('成批搬家：同一批里两行都换天，旧片被摘空删除', async () => {
    const f = fakeKv<LedgerShard>()
    const s = store(f.table)
    await s.putMany([row(SID, 1), row(SID, 2)])
    await s.putMany([row(SID, 1, { day: '2026-09-22' }), row(SID, 2, { day: '2026-09-22' })])
    expect(f.raw.has(ledgerShardKey(SID, DAY))).toBe(false)
    expect(s.size).toBe(2)
    expect(f.raw.get(ledgerShardKey(SID, '2026-09-22'))!.rows).toHaveLength(2)
  })

  it('启动时把已有分片建成索引', async () => {
    const f = fakeKv<LedgerShard>()
    await store(f.table).put(row(SID, 1).id, row(SID, 1))
    const reopened = store(f.table)
    expect(reopened.size).toBe(1)
    expect(reopened.get(row(SID, 1).id)).toBeDefined()
    expect(reopened.shardCount).toBe(1)
  })
})

describe('aggregateOnce(rebuild)：一次性重建', () => {
  const header = { id: SID, createdAt: 1_700_000_000_000 }
  const events = [
    { seq: 1, time: 1_700_000_050_000, type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-v4-flash' } },
    { seq: 2, time: 1_700_000_100_000, type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 10 } } },
  ]

  function harness(installAt: number) {
    const ledger = fakeKv<LedgerShard>()
    const folds = fakeKv<FoldState>()
    const store = new LedgerStore(ledger.table as never)
    const deps = {
      source: {
        listSessions: async () => [{ header, stamp: 'r1' }],
        readSession: async () => ({ session: header, events }),
      } as unknown as SessionSource,
      ledger: store,
      folds: folds.table,
      diag: fakeKv<Diagnostic>().table,
      aliases: fakeKv<ModelAlias>().table,
      snapshots: fakeKv<PriceSnapshot>().table,
      installAt,
    } as unknown as AggregateDeps
    return { deps, ledger, folds, store }
  }

  it('水位已写好时普通一趟跳过；重建那一趟不看水位', async () => {
    const h = harness(1_699_000_000_000)
    await aggregateOnce(h.deps, { force: true })
    expect((await aggregateOnce(h.deps, { force: true })).skipped).toBe(1)
    const rebuilt = await aggregateOnce(h.deps, { force: true, rebuild: true })
    expect(rebuilt.folded).toBe(1)
    expect(rebuilt.skipped).toBe(0)
  })

  it('连跑两趟重建：分片记录字节完全相同（幂等，不重复计费）', async () => {
    const h = harness(1_699_000_000_000)
    await aggregateOnce(h.deps, { force: true, rebuild: true })
    const once = JSON.stringify([...h.ledger.raw.entries()])
    expect(h.store.size).toBe(1)
    await aggregateOnce(h.deps, { force: true, rebuild: true })
    expect(JSON.stringify([...h.ledger.raw.entries()])).toBe(once)
    expect(h.store.size).toBe(1)
    expect(h.folds.raw.has(foldKey(SID))).toBe(true)
  })

  it('重建按会话成批落盘：一个会话只写一次', async () => {
    const h = harness(1_699_000_000_000)
    await aggregateOnce(h.deps, { force: true, rebuild: true })
    expect(h.ledger.writes()).toBe(1)
  })

  it('重建按传入的首次安装时刻判 backfilled', async () => {
    const before = harness(1_699_000_000_000)
    await aggregateOnce(before.deps, { force: true, rebuild: true })
    expect(before.store.all()[0]!.backfilled).toBe(false)
    const after = harness(1_799_000_000_000)
    await aggregateOnce(after.deps, { force: true, rebuild: true })
    expect(after.store.all()[0]!.backfilled).toBe(true)
  })

  it('单会话读失败：不落行、不推进水位（下轮重试）', async () => {
    const h = harness(1_699_000_000_000)
    const broken = {
      listSessions: async () => [{ header, stamp: 'r1' }],
      readSession: async () => { throw new Error('boom') },
    } as unknown as SessionSource
    const stats = await aggregateOnce({ ...h.deps, source: broken }, { force: true, rebuild: true })
    expect(stats.failures).toBe(1)
    expect(h.store.size).toBe(0)
    expect(h.folds.raw.size).toBe(0)
  })
})
