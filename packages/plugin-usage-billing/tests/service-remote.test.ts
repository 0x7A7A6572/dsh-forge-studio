import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { UsageBillingService } from '../src/service.ts'
import { aggregateOnce } from '../src/aggregate.ts'
import type { AggregateDeps, SessionSource } from '../src/aggregate.ts'
import { USAGE_BILLING_METHOD_NAMES, USAGE_BILLING_REMOTE_METHODS } from '../src/remote-methods.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from '../src/pricing/catalog.ts'
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

async function writeBaseSnapshot(svc: UsageBillingService): Promise<void> {
  await svc.ensureBaseSnapshot({
    'deepseek/deepseek-v4-flash': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY' },
  }, 7, 'default')
}

/**
 * 目录层快照（`reason: 'install'`）：`catalogValueOf` 只重放 `install` /
 * `catalog-refresh` / `manual-refresh` 三层（`CATALOG_REASONS`），
 * 所以「目录原本多少钱」必须由这样的快照承载。
 */
async function writeCatalogSnapshot(svc: UsageBillingService): Promise<void> {
  await svc.ensureBaseSnapshot({ ...BUILTIN_CATALOG }, DEFAULT_USD_TO_CNY, 'default')
}

describe('UsageBillingService', () => {
  it('标记的 Remote 方法名单与唯一来源一致，且门面参数个数逐条匹配', () => {
    const marked = (UsageBillingService.prototype as unknown as Record<string, { methods: Array<{ method: string }> }>)
      ['@deepseek-ai/dsh-typert-protocol/remote-methods']!
    expect(marked.methods.map((m) => m.method)).toEqual([...USAGE_BILLING_METHOD_NAMES])
    // 名字对上还不够：client 传参个数是硬契约，门面形参个数必须与声明完全一致。
    const facade = UsageBillingService.prototype as unknown as Record<string, unknown>
    for (const spec of USAGE_BILLING_REMOTE_METHODS) {
      const fn = facade[spec.method]
      expect(typeof fn, `${spec.method} 应是门面上的函数`).toBe('function')
      expect((fn as (...args: unknown[]) => unknown).length, `${spec.method} 的形参个数`).toBe(spec.params.length)
    }
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

  it('同一毫秒内两次 setCustomPrice 串行化：两笔价都在，账本记下 base + 两条 delta', async () => {
    const { svc, snapshots } = makeService()
    // 不 await 第一笔就发第二笔：读-改-写不串行时两次都会读到同一份旧表、写同一个
    // `${prevId}#delta` 键，后一笔 put 会把前一笔的改价悄悄盖掉（snapshot 账本是唯一持久价态）。
    const p1 = svc.setCustomPrice({
      provider: 'acme', model: 'model-a', currency: 'CNY', input: 1, cacheRead: 0, cacheWrite: 0, output: 2,
    })
    const p2 = svc.setCustomPrice({
      provider: 'acme', model: 'model-b', currency: 'CNY', input: 3, cacheRead: 0, cacheWrite: 0, output: 4,
    })
    await Promise.all([p1, p2])

    const entries = (await svc.pricing()).entries
    expect(entries['acme/model-a']).toMatchObject({ input: 1, output: 2 })
    expect(entries['acme/model-b']).toMatchObject({ input: 3, output: 4 })

    const all = [...snapshots.entries()].map(([, s]) => s)
    const deltas = all.filter((s) => s.reason === 'custom-price')
    expect(all.filter((s) => s.kind === 'base')).toHaveLength(1)
    expect(deltas).toHaveLength(2)
    // 两笔改动分别留在两条 delta 里，且 id 各不相同（没有互相覆盖同一个键）。
    expect(deltas.flatMap((s) => Object.keys(s.entries)).sort()).toEqual(['acme/model-a', 'acme/model-b'])
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length)
  })

  it('价表为空时先写自定义价：首条 base 用兜底汇率且不叫 #delta，install 基准仍能补写', async () => {
    const { svc, snapshots } = makeService()
    await snapshots.delete(SNAPSHOT.id)
    // 空价表解析出的是合成 0 汇率，直接落进 base 会让所有 USD 条目永远算不出钱。
    await svc.setCustomPrice({
      provider: 'openai', model: 'gpt-4o', currency: 'USD', input: 2.5, cacheRead: 1.25, cacheWrite: 2.5, output: 10,
    })
    const first = [...snapshots.entries()].map(([, s]) => s)[0]!
    expect(first).toMatchObject({ kind: 'base', usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'default' })
    expect(first.id.endsWith('#delta')).toBe(false)

    // 旧守卫（「有任何快照就返回」）会在这里永久跳过 install 基准；新守卫只看有没有 install 层。
    await writeBaseSnapshot(svc)
    expect([...snapshots.entries()].some(([, s]) => s.reason === 'install')).toBe(true)
  })

  it('removeCustomPrice 对没有自定义价的 key：报不成功且不追加快照', async () => {
    const { svc, snapshots } = makeService()
    // 该 key 既没有自定义价、也不在目录里 —— 删除必须是 no-op（不成功、不追加空 delta）。
    const out = await svc.removeCustomPrice('deepseek/no-such-model')
    expect(out).toMatchObject({ ok: false })
    expect([...snapshots.entries()]).toHaveLength(1) // 只有 snap-1，没有追加
  })

  it('目录模型设置自定义价再取消：恢复目录价而非删除条目，未计价行可重算', async () => {
    const { svc, ledger, snapshots } = makeService()
    const key = 'deepseek/deepseek-v4-flash'
    await snapshots.delete(SNAPSHOT.id) // ensureBaseSnapshot 只在没有 install 层时写
    await writeCatalogSnapshot(svc)
    await svc.setCustomPrice({
      provider: 'deepseek', model: 'deepseek-v4-flash', currency: 'CNY',
      input: 99, cacheRead: 0, cacheWrite: 0, output: 99,
    })
    expect((await svc.pricing()).entries[key]).toMatchObject({ input: 99 })

    // 该行按目录价窗口（time 早于自定义价快照）应能重算：价完全恢复后才会 priced。
    await ledger.put('a', { ...ROW, id: 'a', time: 2_000, costCny: 0, priced: false })
    expect(await svc.removeCustomPrice(key)).toEqual({ ok: true })

    // 目录层有价 → 取消自定义价必须**恢复到目录价**，而不是把条目删成 undefined。
    expect((await svc.pricing()).entries[key]).toEqual(BUILTIN_CATALOG[key])
    expect(await svc.repricing()).toMatchObject({ changed: 1 })
    expect(ledger.get('a')).toMatchObject({ priced: true, costCny: 0.5, currency: 'CNY' })
  })

  it('目录模型没有被自定义过时取消：报不成功且不动快照', async () => {
    const { svc, snapshots } = makeService()
    // snap-1 是 install 层（目录层），flash 的价就来自目录 —— 取消它不是「有自定义价可取消」。
    const before = snapshots.size
    expect(await svc.removeCustomPrice('deepseek/deepseek-v4-flash')).toEqual({ ok: false })
    expect(snapshots.size).toBe(before)
  })

  it('价完全来自自定义价的模型：取消后 key 从价表消失', async () => {
    const { svc } = makeService()
    const key = 'acme/only-custom' // 目录层没有这个 key
    await svc.setCustomPrice({
      provider: 'acme', model: 'only-custom', currency: 'USD',
      input: 1, cacheRead: 0, cacheWrite: 0, output: 2,
    })
    expect((await svc.pricing()).entries[key]).toBeDefined()
    expect(await svc.removeCustomPrice(key)).toEqual({ ok: true })
    expect((await svc.pricing()).entries[key]).toBeUndefined()
  })

  it('setAlias / aliasList 往返', async () => {
    const { svc } = makeService()
    await svc.setAlias({ provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: 'deepseek-v4-flash' })
    expect((await svc.aliasList()).aliases).toHaveLength(1)
    await svc.setAlias({ provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: null })
    expect((await svc.aliasList()).aliases).toHaveLength(0)
  })

  it('setAlias 写入时 trim canonicalModel：展示合并与查价因此落到同一个 key', async () => {
    const { svc, ledger } = makeService()
    await svc.setAlias({ provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: '  deepseek-v4-flash  ' })
    // 展示层按 trim 判定「别名有效」，查价候选却按原样拼 `${provider}/${canonicalModel}` ——
    // 不 trim 就会出现「合并对了、目录价永远解析不到」。只去空白，不过 normalizeModelId。
    expect((await svc.aliasList()).aliases[0]?.canonicalModel).toBe('deepseek-v4-flash')

    await ledger.put('a', { ...ROW, id: 'a', model: 'v4f-x', costCny: 0, priced: false })
    expect(await svc.repricing()).toMatchObject({ changed: 1 })
    expect(ledger.get('a')).toMatchObject({ priced: true, costCny: 1, currency: 'CNY' })
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

    await writeBaseSnapshot(svc)

    expect(snapshots.size).toBe(1)
    expect((await aggregateOnce(deps)).cached).toBe(false)
  })
})
