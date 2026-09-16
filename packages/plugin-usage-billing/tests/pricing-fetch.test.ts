import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  fetchPricingFromNetwork, projectModelsDev, resetPricingFetchCache,
} from '../src/pricing/fetch.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from '../src/pricing/catalog.ts'
import { planSnapshot, resolveSnapshotAt } from '../src/pricing/snapshot.ts'
import { UsageBillingService } from '../src/service.ts'
import { USAGE_BILLING_CONFIG_BASE, createUsageBillingSettingsAccess } from '../src/settings.ts'
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

/** models.dev 的真实投影形状（只保留本设计用到的字段）。 */
const MODELS_DEV = {
  deepseek: {
    id: 'deepseek',
    models: {
      'deepseek-v4-flash': { id: 'deepseek-v4-flash', cost: { input: 0.42, output: 1.68, cache_read: 0.084 } },
    },
  },
  openai: {
    id: 'openai',
    models: { 'gpt-4o': { id: 'gpt-4o', cost: { input: 2.5, output: 10 } } },
  },
}

const text = (content: string, kind = 'text') =>
  async (): Promise<{ url: string; statusCode: number; body: { kind: string; content: string }; truncated: boolean }> =>
    ({ url: 'x', statusCode: 200, body: { kind, content }, truncated: false })

function web(routes: Record<string, () => Promise<unknown>>) {
  const calls: string[] = []
  return {
    calls,
    fetch: async (req: { url: string }) => {
      calls.push(req.url)
      const hit = routes[req.url]
      if (hit === undefined) throw new Error(`unexpected url ${req.url}`)
      return await hit() as never
    },
  }
}

function deps(
  webImpl: ReturnType<typeof web>,
  snapshots: KvTable<string, PriceSnapshot>,
  now = () => 1_000_000,
  entries: Record<string, PriceEntry> = { ...BUILTIN_CATALOG },
) {
  const base = planSnapshot(undefined, { entries, usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'default' },
    { id: 'snap-install', at: 0, reason: 'install' })!
  void snapshots.put(base.id, base)
  return { web: webImpl, snapshots, now }
}

beforeEach(() => { resetPricingFetchCache() })

describe('projectModelsDev', () => {
  it('投影成 provider/model → 四个价（cache_write 缺失按 input 兜底为 0）', () => {
    const out = projectModelsDev(MODELS_DEV)
    expect(out['deepseek/deepseek-v4-flash']).toEqual({ input: 0.42, cacheRead: 0.084, cacheWrite: 0, output: 1.68, currency: 'USD' })
    expect(out['openai/gpt-4o']).toMatchObject({ input: 2.5, output: 10, currency: 'USD' })
  })

  it('结构不认识时返回空对象而不抛', () => {
    expect(projectModelsDev(null)).toEqual({})
    expect(projectModelsDev({ deepseek: { models: 'nope' } })).toEqual({})
    expect(projectModelsDev([1, 2])).toEqual({})
  })
})

describe('fetchPricingFromNetwork', () => {
  it('成功时合并目录、更新汇率并追加 delta 快照', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    const out = await fetchPricingFromNetwork(deps(w, snapshots))
    expect(out).toMatchObject({ ok: true, usdToCny: 7.15 })
    const snaps = [...snapshots.entries()].map(([, s]) => s)
    expect(snaps).toHaveLength(2)
    expect(snaps[1]!.kind).toBe('delta')
    expect(snaps[1]!.reason).toBe('catalog-refresh')
  })

  it('拉取失败 → ok:false、不追加快照、保留内置价', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({ 'https://models.dev/api.json': async () => { throw new Error('offline') } })
    const out = await fetchPricingFromNetwork(deps(w, snapshots))
    expect(out.ok).toBe(false)
    expect(snapshots.size).toBe(1)
  })

  it('汇率失败但目录成功 → 用默认汇率并标记 default', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': async () => { throw new Error('fx down') },
    })
    const out = await fetchPricingFromNetwork(deps(w, snapshots))
    expect(out).toMatchObject({ ok: true, usdToCny: DEFAULT_USD_TO_CNY })
  })

  it('TTL 内第二次调用不再打网络', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    const d = deps(w, snapshots)
    await fetchPricingFromNetwork(d)
    await fetchPricingFromNetwork(d)
    expect(w.calls.filter((u) => u.includes('models.dev'))).toHaveLength(1)
  })

  it('force 忽略 TTL 再打一次', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    const d = deps(w, snapshots)
    await fetchPricingFromNetwork(d)
    await fetchPricingFromNetwork(d, true)
    expect(w.calls.filter((u) => u.includes('models.dev'))).toHaveLength(2)
  })

  it('TTL 来自 refreshHours：窗口内直接复用缓存结果，不打网络', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    let clock = 1_000_000
    const d = deps(w, snapshots, () => clock)
    const first = await fetchPricingFromNetwork(d, false, 1) // 1h
    clock += 30 * 60 * 1000 // 30min 后
    const second = await fetchPricingFromNetwork(d, false, 1)
    expect(second).toEqual(first)
    expect(w.calls.filter((u) => u.includes('models.dev'))).toHaveLength(1)
  })

  it('force: true 时即使 TTL 远未过期也重新拉取', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    let clock = 1_000_000
    const d = deps(w, snapshots, () => clock)
    await fetchPricingFromNetwork(d, false, 24)
    clock += 60 * 1000
    await fetchPricingFromNetwork(d, true, 24)
    expect(w.calls.filter((u) => u.includes('models.dev'))).toHaveLength(2)
  })

  it('refreshHours 缺失 / 非正 → 回退 brief 缺省 6h', async () => {
    for (const ttl of [undefined, 0, -3, Number.NaN]) {
      resetPricingFetchCache()
      const snapshots = table<PriceSnapshot>()
      const w = web({
        'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
        'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
      })
      let clock = 1_000_000
      const d = deps(w, snapshots, () => clock)
      const modelsDevCalls = () => w.calls.filter((u) => u.includes('models.dev')).length
      await fetchPricingFromNetwork(d, false, ttl)
      clock += 5 * 60 * 60 * 1000 // 5h < 6h：仍在缺省 TTL 内
      await fetchPricingFromNetwork(d, false, ttl)
      expect(modelsDevCalls(), `refreshHours=${String(ttl)}`).toBe(1)
      clock += 2 * 60 * 60 * 1000 // 累计 7h > 6h：过期后重新拉取
      await fetchPricingFromNetwork(d, false, ttl)
      expect(modelsDevCalls(), `refreshHours=${String(ttl)}`).toBe(2)
    }
  })

  it('refreshHours 夹到上限一个月：离谱的大值不会把刷新永久关掉', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    let clock = 1_000_000
    const d = deps(w, snapshots, () => clock)
    const modelsDevCalls = () => w.calls.filter((u) => u.includes('models.dev')).length
    await fetchPricingFromNetwork(d, false, 100_000) // 11 年：夹到 30 天
    clock += 29 * 24 * 60 * 60 * 1000 // 29 天 < 30 天：仍在窗口内
    await fetchPricingFromNetwork(d, false, 100_000)
    expect(modelsDevCalls()).toBe(1)
    clock += 2 * 24 * 60 * 60 * 1000 // 累计 31 天 > 30 天：必须重新拉取
    await fetchPricingFromNetwork(d, false, 100_000)
    expect(modelsDevCalls()).toBe(2)
  })

  it('失败缓存最多 1 分钟：一次离线不会把重试锁死整个 TTL', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({ 'https://models.dev/api.json': async () => { throw new Error('offline') } })
    let clock = 1_000_000
    const d = deps(w, snapshots, () => clock)
    const modelsDevCalls = () => w.calls.filter((u) => u.includes('models.dev')).length
    expect((await fetchPricingFromNetwork(d, false, 6)).ok).toBe(false)
    expect(modelsDevCalls()).toBe(1)
    clock += 30_000 // 30s < 60s：失败结果仍在短窗口内被复用（调度器每分钟重试不会打爆网络）
    expect((await fetchPricingFromNetwork(d, false, 6)).ok).toBe(false)
    expect(modelsDevCalls()).toBe(1)
    clock += 31_000 // 累计 61s > 60s：必须真的重试
    expect((await fetchPricingFromNetwork(d, false, 6)).ok).toBe(false)
    expect(modelsDevCalls()).toBe(2)
  })

  it('成功仍按 TTL 缓存：60s 后不重试（与失败窗口不同）', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    let clock = 1_000_000
    const d = deps(w, snapshots, () => clock)
    expect((await fetchPricingFromNetwork(d, false, 6)).ok).toBe(true)
    clock += 61_000
    expect((await fetchPricingFromNetwork(d, false, 6)).ok).toBe(true)
    expect(w.calls.filter((u) => u.includes('models.dev'))).toHaveLength(1)
  })

  it('同表并发强制刷新只下载一次（in-flight 合并），也只写一条快照', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    const d = deps(w, snapshots)
    const [a, b] = await Promise.all([fetchPricingFromNetwork(d, true), fetchPricingFromNetwork(d, true)])
    expect(a).toEqual(b)
    expect(w.calls.filter((u) => u.includes('models.dev'))).toHaveLength(1)
    // 两次同刻刷新若各写一份快照，还会撞同一个 `${prevId}#cat-${now}` 键。
    expect(snapshots.size).toBe(2)
  })

  it('空账本上的目录刷新：base 用 base 命名（snap-base），不是 delta 形状的 id', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    const out = await fetchPricingFromNetwork({ web: w, snapshots, now: () => 1_000_000 })
    expect(out.ok).toBe(true)
    const snaps = [...snapshots.entries()].map(([, s]) => s)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({ id: 'snap-base', kind: 'base', reason: 'catalog-refresh' })
  })

  it('两次完全相同的刷新（同值且同来源）→ 第二次不追加空 delta', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: DEFAULT_USD_TO_CNY } })),
    })
    const d = deps(w, snapshots)
    // 第一次刷新把在效汇率从「内置缺省 / default」推到「实时同值 / live」——来源变了，属实质变化。
    expect((await fetchPricingFromNetwork(d)).ok).toBe(true)
    expect(snapshots.size).toBe(2)
    // 第二次刷新与此刻的在效状态逐字相同 → 不追加记录。
    await fetchPricingFromNetwork(d, true)
    expect(snapshots.size).toBe(2)
  })

  it('models.dev 解析成功但 0 条（空投影）→ ok:false、不追加快照', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text('{}'),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    const out = await fetchPricingFromNetwork(deps(w, snapshots))
    // 空投影若报成功，下一次 resolve 会把全部「只来自联网」的模型当成目录已删而抹掉。
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/models\.dev/)
    expect(snapshots.size).toBe(1)
  })

  it('汇率数值不变但来源 default → live：仍追加一条记录（空 entries、无 removed），新来源可见', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: DEFAULT_USD_TO_CNY } })),
    })
    // 基准里已经含本次要抓到的目录（空投影已按新语义判失败），于是这次刷新与此刻在效状态
    // 只差「来源 default → live」这一项。
    const out = await fetchPricingFromNetwork(deps(w, snapshots, () => 1_000_000, {
      ...BUILTIN_CATALOG, ...projectModelsDev(MODELS_DEV),
    }))
    expect(out).toMatchObject({ ok: true, usdToCny: DEFAULT_USD_TO_CNY })
    const snaps = [...snapshots.entries()].map(([, s]) => s)
    expect(snaps).toHaveLength(2)
    expect(snaps[1]).toMatchObject({ kind: 'delta', usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'live' })
    expect(snaps[1]!.entries).toEqual({})
    expect(snaps[1]!.removed ?? []).toEqual([])
    // 来源是 provenance：必须如实进入在效价表（否则账本把一次回退误报成 live）。
    expect(resolveSnapshotAt(1_000_000, snaps)).toMatchObject({ usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'live' })
  })

  it('body.kind 为 html 也能解析（fetch 没有 json 分支）', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV), 'html'),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    expect((await fetchPricingFromNetwork(deps(w, snapshots))).ok).toBe(true)
  })
})

/** 汇率降级契约（pin）：非正 / 非有限汇率一律回落默认值，绝不落盘 0。 */
describe('fetchUsdCny 降级', () => {
  it('汇率非正数 → 回落默认汇率，且快照里绝不出现非正汇率', async () => {
    for (const bad of [0, -3]) {
      resetPricingFetchCache()
      const snapshots = table<PriceSnapshot>()
      const w = web({
        'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
        'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: bad } })),
      })
      const out = await fetchPricingFromNetwork(deps(w, snapshots))
      expect(out, `CNY=${bad}`).toMatchObject({ ok: true, usdToCny: DEFAULT_USD_TO_CNY })
      expect([...snapshots.entries()].every(([, s]) => s.usdToCny > 0), `CNY=${bad}`).toBe(true)
      // 降级必须如实标注 default 来源，UI 才能显示「内置价」。
      expect([...snapshots.entries()].every(([, s]) => s.usdToCnySource === 'default'), `CNY=${bad}`).toBe(true)
    }
  })
})

/** 目录刷新契约（pin）：刷新失败不碰账本，成功也不许抹掉用户自定义价。 */
describe('刷新与自定义价 / 账本', () => {
  function harness() {
    const snapshots = table<PriceSnapshot>()
    const base = planSnapshot(undefined, { entries: { ...BUILTIN_CATALOG }, usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'default' },
      { id: 'snap-install', at: 0, reason: 'install' })!
    void snapshots.put(base.id, base)
    const ledger = table<LedgerRow>()
    const folds = table<FoldState>()
    const aliases = table<ModelAlias>()
    const diag = table<Diagnostic>()
    const domain = {
      table: (name: string) => ({ ledger, folds, snapshots, aliases, diag } as Record<string, unknown>)[name],
    } as never
    return { snapshots, ledger, folds, aliases, diag, domain }
  }

  function serviceFor(
    h: ReturnType<typeof harness>,
    w: ReturnType<typeof web>,
    clock: () => number = () => 1_000_000,
  ) {
    return new UsageBillingService(new Context(), {
      domain: h.domain,
      settings: createUsageBillingSettingsAccess(),
      installAt: 0,
      source: {
        listSessions: async () => [],
        listEvents: async () => [],
        readSession: async () => { throw new Error('unused') },
      },
      fetchPricing: (opts) =>
        fetchPricingFromNetwork({ web: w, snapshots: h.snapshots, now: clock }, opts.force, opts.ttlHours),
      now: clock,
    })
  }

  it('并发刷新与改价（不同 key）：刷新拉到的 key 不被改价的差分抹掉，且没有任何记录写 removed', async () => {
    const h = harness()
    const KEY_CUSTOM = 'deepseek/deepseek-v4-flash'
    // gpt-4o 内置已有价、这次联网改了它；haiku 是「只来自联网」的新 key（不在内置表里）。
    const KEY_CHANGED = 'openai/gpt-4o'
    const KEY_NEW = 'anthropic/claude-haiku-4'
    const CLOCK = 1_000_000
    const changed: PriceEntry = { input: 2.5, cacheRead: 1.25, cacheWrite: 1.25, output: 10, currency: 'USD' }
    const fresh: PriceEntry = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5, currency: 'USD' }

    // 确定性交错（不靠计时）：假刷新「先读基线、挂闸、后落盘」，闸门在发起改价之后打开。
    // 未串行化时：改价先读到旧表 → 刷新落盘 → 改价的 appendDelta 才拿新表当基线做差分，
    // diffEntries 于是对只来自联网的新 key 发 removed，并把联网改过价的 key 按旧值重新加回来。
    let openRefreshWrite!: () => void
    const writeGate = new Promise<void>((resolve) => { openRefreshWrite = resolve })
    let baselineRead!: () => void
    const baselineCaptured = new Promise<void>((resolve) => { baselineRead = resolve })

    const svc = new UsageBillingService(new Context(), {
      domain: h.domain,
      settings: createUsageBillingSettingsAccess(),
      installAt: 0,
      source: {
        listSessions: async () => [],
        listEvents: async () => [],
        readSession: async () => { throw new Error('unused') },
      },
      fetchPricing: async () => {
        const all = [...h.snapshots.entries()].map(([, s]) => s)
        const prev = resolveSnapshotAt(CLOCK, all)
        const entries = { ...prev.entries, [KEY_CHANGED]: { ...changed }, [KEY_NEW]: { ...fresh } }
        baselineRead()
        await writeGate
        const snap = planSnapshot(prev, { entries, usdToCny: 7.15, usdToCnySource: 'live' },
          { id: `${prev.snapshotId}#cat-${CLOCK}`, at: CLOCK, reason: 'catalog-refresh' })
        if (snap !== null) await h.snapshots.put(snap.id, snap)
        return { ok: true, entries: 2, usdToCny: 7.15 }
      },
      now: () => CLOCK,
    })

    const refresh = svc.refreshPricing(true)
    await baselineCaptured
    const write = svc.setCustomPrice({
      provider: 'deepseek', model: 'deepseek-v4-flash', currency: 'CNY',
      input: 9, cacheRead: 9, cacheWrite: 9, output: 9,
    })
    openRefreshWrite()
    expect((await refresh).ok).toBe(true)
    await write

    const entries = (await svc.pricing()).entries
    expect(entries[KEY_NEW]).toMatchObject(fresh)
    expect(entries[KEY_CHANGED]).toMatchObject(changed)
    expect(entries[KEY_CUSTOM]).toMatchObject({ input: 9, cacheRead: 9, cacheWrite: 9, output: 9, currency: 'CNY' })
    const bogusRemoved = [...h.snapshots.entries()].map(([, s]) => s)
      .filter((s) => (s.removed ?? []).some((k) => k === KEY_NEW || k === KEY_CHANGED))
    expect(bogusRemoved).toEqual([])
  })

  it('成功刷新后自定义价仍在生效价表里', async () => {
    const h = harness()
    const w = web({
      'https://models.dev/api.json': text(JSON.stringify(MODELS_DEV)),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    })
    const svc = serviceFor(h, w)
    await svc.setCustomPrice({
      provider: 'deepseek', model: 'deepseek-v4-flash', currency: 'CNY',
      input: 9, cacheRead: 9, cacheWrite: 9, output: 9,
    })
    expect((await svc.refreshPricing(true)).ok).toBe(true)
    expect((await svc.pricing()).entries['deepseek/deepseek-v4-flash']).toMatchObject({
      input: 9, cacheRead: 9, cacheWrite: 9, output: 9, currency: 'CNY',
    })
  })

  it('刷新失败时账本与生效价表都不动', async () => {
    const h = harness()
    const w = web({ 'https://models.dev/api.json': async () => { throw new Error('offline') } })
    const svc = serviceFor(h, w)
    const before = await svc.pricing()
    const out = await svc.refreshPricing(true)
    expect(out.ok).toBe(false)
    expect(h.snapshots.size).toBe(1)
    expect(await svc.pricing()).toEqual(before)
  })

  it('取消自定义价后目录再调价：价表跟新目录价，而不是取消当刻的旧价', async () => {
    const h = harness()
    const key = 'deepseek/deepseek-v4-flash'
    const dev = (input: number, output: number, cacheRead: number) => ({
      deepseek: { id: 'deepseek', models: { 'deepseek-v4-flash': { id: 'deepseek-v4-flash', cost: { input, output, cache_read: cacheRead } } } },
    })
    let clock = 1_000_000
    const routes: Record<string, () => Promise<unknown>> = {
      'https://models.dev/api.json': text(JSON.stringify(dev(0.42, 1.68, 0.084))),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: 7.15 } })),
    }
    const w = web(routes)
    const svc = serviceFor(h, w, () => clock)

    await svc.setCustomPrice({
      provider: 'deepseek', model: 'deepseek-v4-flash', currency: 'CNY',
      input: 9, cacheRead: 9, cacheWrite: 9, output: 9,
    })
    clock += 1000
    expect((await svc.refreshPricing(true)).ok).toBe(true)
    expect((await svc.pricing()).entries[key]).toMatchObject({ input: 9, output: 9, currency: 'CNY' })

    // 取消：写回的目录价是「取消当刻」目录层的 0.5 / 2（内置值）。
    clock += 1000
    expect(await svc.removeCustomPrice(key)).toEqual({ ok: true })
    expect((await svc.pricing()).entries[key]).toMatchObject({ input: 0.5, output: 2, currency: 'CNY' })

    // 目录此后调价 → 该 key 必须跟着**新**目录价走。整层重放 custom-price 会把旧价永久钉住。
    clock += 1000
    routes['https://models.dev/api.json'] = text(JSON.stringify(dev(1.5, 6, 0.3)))
    expect((await svc.refreshPricing(true)).ok).toBe(true)
    expect((await svc.pricing()).entries[key]).toMatchObject({
      input: 1.5, cacheRead: 0.3, output: 6, currency: 'USD',
    })
  })

  it('refreshPricing 把 force 与 settings.pricing.refreshHours 透传给拉取层', async () => {
    const h = harness()
    const settings = createUsageBillingSettingsAccess()
    const cfg = structuredClone(USAGE_BILLING_CONFIG_BASE)
    cfg.pricing.refreshHours = 2
    settings.bind({ get: () => cfg, watch: () => () => {} })
    const seen: Array<{ force: boolean; ttlHours: number }> = []
    const svc = new UsageBillingService(new Context(), {
      domain: h.domain,
      settings,
      installAt: 0,
      source: {
        listSessions: async () => [],
        listEvents: async () => [],
        readSession: async () => { throw new Error('unused') },
      },
      fetchPricing: async (opts) => { seen.push(opts); return { ok: true, entries: 3, usdToCny: 7.15 } },
      now: () => 1_000_000,
    })

    expect(await svc.refreshPricing(false)).toEqual({ ok: true, entries: 3, usdToCny: 7.15 })
    expect((await svc.refreshPricing(true)).ok).toBe(true)
    expect(seen).toEqual([{ force: false, ttlHours: 2 }, { force: true, ttlHours: 2 }])
  })
})
