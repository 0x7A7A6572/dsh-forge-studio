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

function deps(webImpl: ReturnType<typeof web>, snapshots: KvTable<string, PriceSnapshot>, now = () => 1_000_000) {
  const base = planSnapshot(undefined, { entries: { ...BUILTIN_CATALOG }, usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'default' },
    { id: 'snap-install', at: 0, reason: 'install' })!
  void snapshots.put(base.id, base)
  return { web: webImpl, snapshots, installAt: 0, now }
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

  it('两次完全相同的刷新（同值且同来源）→ 第二次不追加空 delta', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text('{}'),
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

  it('汇率数值不变但来源 default → live：仍追加一条记录（空 entries、无 removed），新来源可见', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text('{}'),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: DEFAULT_USD_TO_CNY } })),
    })
    const out = await fetchPricingFromNetwork(deps(w, snapshots))
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
        fetchPricingFromNetwork({ web: w, snapshots: h.snapshots, installAt: 0, now: clock }, opts.force, opts.ttlHours),
      now: clock,
    })
  }

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
