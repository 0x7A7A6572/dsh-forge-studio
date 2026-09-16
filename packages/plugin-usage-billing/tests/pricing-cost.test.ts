import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { priceUsage, splitUsage } from '../src/pricing/cost.ts'
import { priceKeyCandidates } from '../src/model-key.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from '../src/pricing/catalog.ts'
import type { PriceEntry } from '../src/types.ts'

const cny: PriceEntry = { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 10, currency: 'CNY' }
const usd: PriceEntry = { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 10, currency: 'USD' }

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 1_000_000, outputTokens: 1_000_000, ...over,
})

describe('splitUsage', () => {
  it('四桶互斥，缺失的缓存字段按 0', () => {
    expect(splitUsage(usage({ cacheReadTokens: 5, reasoningTokens: 3 })))
      .toEqual({ input: 1_000_000, cacheRead: 5, cacheWrite: 0, output: 1_000_000, reason: 3 })
  })
})

/**
 * 实测故障：模型走中转渠道（`ds-hk` / `modlens-ds-hk`）而内置目录里只有
 * `deepseek/deepseek-v4-flash` —— 查价档位全挂在 provider 前缀上，于是明明是同名的官方模型，
 * 界面上永远是「未收录」。同名兜底（首段为 `*` 的候选）就是这一档。
 */
describe('同名兜底查价（跨 provider，按模型名）', () => {
  const catalog = {
    'deepseek/deepseek-v4-flash': cny,
    'deepseek/deepseek-v4-pro': { ...cny, input: 4 },
  }

  it('中转 provider 的同名模型用目录价，不再是「未收录」', () => {
    const keys = priceKeyCandidates('ds-hk', 'deepseek-v4-flash')
    const r = priceUsage(usage(), catalog, keys, 7)
    expect(r.priced).toBe(true)
    expect(r.costCny).toBeCloseTo(11, 10)   // 1M input × 1 + 1M output × 10
    expect(r.matchedKey).toBe('*/deepseek-v4-flash')
  })

  it('带组织前缀 / 日期后缀的写法同样能对上同名价', () => {
    const prefixed = priceUsage(usage(), catalog, priceKeyCandidates('relay', 'deepseek/deepseek-v4-flash'), 7)
    expect(prefixed.matchedKey).toBe('*/deepseek-v4-flash')
    const dated = priceUsage(usage(), catalog, priceKeyCandidates('relay', 'deepseek-v4-flash-20260518'), 7)
    expect(dated.matchedKey).toBe('*/deepseek-v4-flash')
  })

  it('精确命中优先于同名兜底', () => {
    const table = { ...catalog, 'ds-hk/deepseek-v4-flash': { ...cny, input: 100 } }
    const r = priceUsage(usage(), table, priceKeyCandidates('ds-hk', 'deepseek-v4-flash'), 7)
    expect(r.matchedKey).toBe('ds-hk/deepseek-v4-flash')
  })

  it('provider 兜底优先于全局兜底，但低于同名兜底', () => {
    const table = { ...catalog, 'ds-hk/*': { ...cny, input: 50 }, '*/*': { ...cny, input: 60 } }
    expect(priceUsage(usage(), table, priceKeyCandidates('ds-hk', 'deepseek-v4-flash'), 7).matchedKey)
      .toBe('*/deepseek-v4-flash')
    // 名字对不上时才轮到 provider 兜底
    expect(priceUsage(usage(), table, priceKeyCandidates('ds-hk', 'some-unknown'), 7).matchedKey)
      .toBe('ds-hk/*')
    // 连 provider 都没有时才用全局兜底
    expect(priceUsage(usage(), table, priceKeyCandidates('other', 'some-unknown'), 7).matchedKey)
      .toBe('*/*')
  })

  it('同名价有多个 provider 时取表内第一条（内置目录先写入，官方价优先）', () => {
    const table = {
      'deepseek/deepseek-v4-flash': { ...cny, input: 1 },
      'openrouter/deepseek-v4-flash': { ...cny, input: 9 },
    }
    const r = priceUsage(usage(), table, priceKeyCandidates('ds-hk', 'deepseek-v4-flash'), 7)
    // `matchedKey` 报的是命中**档位**（`*/` 候选），不是表内的具体 provider 键；
    // 「谁被选中」体现在金额上：官方那条 1M×1 + 1M×10 = 11。
    expect(r.matchedKey).toBe('*/deepseek-v4-flash')
    expect(r.costCny).toBeCloseTo(11, 10)
  })

  it('用**真实内置目录**验证实测故障的那两个模型（ds-hk / modlens-ds-hk 调官方模型）', () => {
    for (const [provider, model] of [['ds-hk', 'deepseek-v4-flash'], ['modlens-ds-hk', 'deepseek-v4-pro']] as const) {
      const r = priceUsage(usage(), BUILTIN_CATALOG, priceKeyCandidates(provider, model), DEFAULT_USD_TO_CNY)
      expect(r.priced, `${provider}/${model} 应当收录`).toBe(true)
      expect(r.costCny).toBeGreaterThan(0)
    }
  })

  it('目录里没有同名模型时仍然如实标记「未收录」', () => {
    const r = priceUsage(usage(), catalog, priceKeyCandidates('ds-hk', 'ghost-model'), 7)
    expect(r).toMatchObject({ priced: false, matchedKey: null, costCny: 0 })
  })
})

describe('priceUsage', () => {
  it('CNY 模型不经过汇率', () => {
    const r = priceUsage(usage(), { 'a/1': cny }, ['a/1'], 7.1)
    // 1M input × 1 + 1M output × 10 = 11
    expect(r.costCny).toBeCloseTo(11, 10)
    expect(r.currency).toBe('CNY')
    expect(r.priced).toBe(true)
    expect(r.matchedKey).toBe('a/1')
    expect(r.matchRank).toBe(0)
  })

  it('USD 模型按快照汇率折算', () => {
    const r = priceUsage(usage(), { 'a/1': usd }, ['a/1'], 7)
    expect(r.costCny).toBeCloseTo(77, 10)
    expect(r.currency).toBe('USD')
  })

  it('缓存桶分列计价，不重复计 input', () => {
    const r = priceUsage(
      usage({ inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, outputTokens: 0 }),
      { 'a/1': cny }, ['a/1'], 7,
    )
    // 1 + 0.1 + 2 = 3.1
    expect(r.costCny).toBeCloseTo(3.1, 10)
  })

  it('reasoning 不单独计价', () => {
    const a = priceUsage(usage(), { 'a/1': cny }, ['a/1'], 7)
    const b = priceUsage(usage({ reasoningTokens: 999_999 }), { 'a/1': cny }, ['a/1'], 7)
    expect(b.costCny).toBeCloseTo(a.costCny, 10)
  })

  it('按 keys 顺序取第一个命中，并报出命中档位', () => {
    const r = priceUsage(usage(), { 'a/1': cny, 'a/*': usd }, ['a/1', 'a/*'], 7)
    expect(r.matchedKey).toBe('a/1')
    const r2 = priceUsage(usage(), { 'a/*': usd }, ['a/1', 'a/*'], 7)
    expect(r2.matchedKey).toBe('a/*')
    expect(r2.matchRank).toBe(1)
  })

  it('全部未命中 → priced=false、cost 0、matchedKey=null（绝不猜价）', () => {
    const r = priceUsage(usage(), {}, ['a/1'], 7)
    expect(r).toMatchObject({ costCny: 0, priced: false, matchedKey: null, matchRank: -1 })
  })

  it('汇率为 0 或负数时 USD 模型不折算成负数', () => {
    const r = priceUsage(usage(), { 'a/1': usd }, ['a/1'], 0)
    expect(r.costCny).toBeGreaterThanOrEqual(0)
    // 汇率不可用 → 标「不可计价」，但 matchedKey 仍在：区别于未收录（null）。
    expect(r.priced).toBe(false)
    expect(r.matchedKey).toBe('a/1')
    expect(r.matchRank).toBe(0)
    const neg = priceUsage(usage(), { 'a/1': usd }, ['a/1'], -1)
    expect(neg.costCny).toBe(0)
    expect(neg.priced).toBe(false)
    expect(neg.matchedKey).toBe('a/1')
  })

  it('汇率为 0 不影响 CNY 价目（原生币种不折算）', () => {
    const r = priceUsage(usage(), { 'a/1': cny }, ['a/1'], 0)
    expect(r.costCny).toBeCloseTo(11, 10)
    expect(r.priced).toBe(true)
    expect(r.matchedKey).toBe('a/1')
  })
})
