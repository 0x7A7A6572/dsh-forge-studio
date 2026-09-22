/**
 * 「同款异名」内置等价表的门禁。
 *
 * 背景：官方 API 名叫 deepseek-flash，目录/仓库名叫 deepseek-v4-flash，渠道行两边都有。
 * 只靠「同名兜底」认不出（名字不同），过去只能手工绑别名 —— 别名一删，历史价表
 * （只有 v4-flash）就命中不了，整段账变 ¥0。这里把「同款」钉在归一化层。
 */
import { describe, expect, it } from 'vitest'
import { normalizeModelId, priceKeyCandidates, sameModelName } from '../packages/plugin-usage-billing/src/model-key.ts'
import { priceUsage } from '../packages/plugin-usage-billing/src/pricing/cost.ts'

/** 历史价表：只有目录名、没有官方 API 名 —— 就是出事的那张 snap-install。 */
const HIST = { 'deepseek/deepseek-v4-flash': { input: 0.5, cacheRead: 0.1, cacheWrite: 0.5, output: 2, currency: 'CNY' as const } }
const USAGE = { inputTokens: 1_000_000, outputTokens: 0 }

describe('内置同款异名表', () => {
  it('把官方 API 名归到目录名', () => {
    expect(normalizeModelId('deepseek-flash')).toBe('deepseek-v4-flash')
    expect(normalizeModelId('deepseek/deepseek-flash')).toBe('deepseek-v4-flash')
    expect(normalizeModelId('deepseek-flash-20260817')).toBe('deepseek-v4-flash')
    expect(normalizeModelId('deepseek-v4-flash')).toBe('deepseek-v4-flash')
  })

  it('展示分组键把两者并成一行（自动归类）', () => {
    expect(sameModelName('deepseek-flash')).toBe(sameModelName('deepseek-v4-flash'))
    expect(sameModelName('deepseek/deepseek-flash')).toBe('deepseek-v4-flash')
  })

  it('不在表里的名字原样保留（不猜）', () => {
    expect(normalizeModelId('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(normalizeModelId('some-other-flash')).toBe('some-other-flash')
    expect(sameModelName('claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514')
  })
})

describe('历史价表上的定价：删掉手工别名也要能算', () => {
  it('ds-hk / deepseek-flash 命中目录的 v4-flash', () => {
    const r = priceUsage(USAGE, HIST, priceKeyCandidates('ds-hk', 'deepseek-flash'), 7.1)
    expect(r.priced).toBe(true)
    // 命中路径是跨 provider 同名兜底（matchedKey 记的是命中的候选，不是表里的 key）。
    expect(r.matchedKey).toBe('*/deepseek-v4-flash')
    expect(r.costCny).toBeCloseTo(0.5, 10)
  })

  it('deepseek-official / deepseek-flash 同理', () => {
    const r = priceUsage(USAGE, HIST, priceKeyCandidates('deepseek-official', 'deepseek-flash'), 7.1)
    expect(r.priced).toBe(true)
    expect(r.matchedKey).toBe('*/deepseek-v4-flash')
    expect(r.costCny).toBeCloseTo(0.5, 10)
  })

  it('手工别名仍然优先（覆盖通道不丢）', () => {
    const table = { 'ds-hk/special-name': { input: 9, cacheRead: 0, cacheWrite: 9, output: 9, currency: 'CNY' as const }, ...HIST }
    const alias = { id: 'ds-hk__deepseek-flash', provider: 'ds-hk', rawModel: 'deepseek-flash', canonicalModel: 'special-name' }
    const r = priceUsage(USAGE, table, priceKeyCandidates('ds-hk', 'deepseek-flash', alias), 7.1)
    expect(r.matchedKey).toBe('ds-hk/special-name')
    expect(r.costCny).toBeCloseTo(9, 10)
  })
})
