import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { priceUsage, splitUsage } from '../src/pricing/cost.ts'
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
  })
})
