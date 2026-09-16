import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  fetchPricingFromNetwork, projectModelsDev, resetPricingFetchCache,
} from '../src/pricing/fetch.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from '../src/pricing/catalog.ts'
import { planSnapshot } from '../src/pricing/snapshot.ts'
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

  it('价与汇率都没变 → 不追加空 delta', async () => {
    const snapshots = table<PriceSnapshot>()
    const w = web({
      'https://models.dev/api.json': text('{}'),
      'https://open.er-api.com/v6/latest/USD': text(JSON.stringify({ rates: { CNY: DEFAULT_USD_TO_CNY } })),
    })
    await fetchPricingFromNetwork(deps(w, snapshots))
    expect(snapshots.size).toBe(1)
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

  function serviceFor(h: ReturnType<typeof harness>, w: ReturnType<typeof web>) {
    return new UsageBillingService(new Context(), {
      domain: h.domain,
      settings: createUsageBillingSettingsAccess(),
      installAt: 0,
      source: {
        listSessions: async () => [],
        listEvents: async () => [],
        readSession: async () => { throw new Error('unused') },
      },
      fetchPricing: () => fetchPricingFromNetwork({ web: w, snapshots: h.snapshots, installAt: 0, now: () => 1_000_000 }),
      now: () => 1_000_000,
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
})
