/**
 * 中继路由标记的归一：`group/auto-gpt-6-astra` 这类 id 要能落到目录里的 `gpt-6-astra`。
 * 只剥带连字符或数字的尾巴，单段泛词（`small` / `flash`）不当标记。
 */
import { describe, expect, it } from 'vitest'
import { priceUsage } from '../packages/plugin-usage-billing/src/pricing/cost.ts'
import { priceKeyCandidates } from '../packages/plugin-usage-billing/src/model-key.ts'
import type { PriceEntry } from '../packages/plugin-usage-billing/src/types.ts'

const usage = { inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 }

const price = (input: number, output: number): PriceEntry => ({
  input, output, cacheRead: 0, cacheWrite: 0, currency: 'USD',
})

const match = (table: Record<string, PriceEntry>, provider: string, model: string) =>
  priceUsage(usage, table, priceKeyCandidates(provider, model), 7.1)

describe('路由标记归一', () => {
  it('剥掉分组前缀后命中目录同名价', () => {
    const hit = match({ 'openai/gpt-6-astra': price(10, 50) }, 'magpie', 'group/auto-gpt-6-astra')
    expect(hit.priced).toBe(true)
    expect(hit.matchedKey).toBe('*/gpt-6-astra')
  })

  it('日期后缀与路由标记叠加时仍命中', () => {
    const hit = match({ 'openai/gpt-6-astra': price(10, 50) }, 'magpie', 'group/auto-gpt-6-astra-20261001')
    expect(hit.priced).toBe(true)
    expect(hit.matchedKey).toBe('*/gpt-6-astra')
  })

  it('单段数字名也按标记剥（auto-k3 → k3）', () => {
    const hit = match({ 'moonshot/k3': price(1, 2) }, 'kimi-code-cn', 'auto-k3')
    expect(hit.priced).toBe(true)
    expect(hit.matchedKey).toBe('*/k3')
  })

  it('单段泛词不当标记，避免误撞目录里的同名模型', () => {
    const hit = match({ 'openai/small': price(1, 2) }, 'magpie', 'custom-small')
    expect(hit.priced).toBe(false)
    expect(hit.matchedKey).toBeNull()
  })

  it('没有命中时依然整齐退出，交给 UI 标未收录', () => {
    const hit = match({ 'openai/gpt-6-astra': price(10, 50) }, 'magpie', 'devin/swe-2-max-lightning')
    expect(hit.priced).toBe(false)
  })
})

describe('候选顺序', () => {
  it('手工别名排在同名兜底之前', () => {
    const keys = priceKeyCandidates('magpie', 'group/auto-gpt-6-astra', {
      id: 'x', provider: 'magpie', rawModel: 'group/auto-gpt-6-astra', canonicalModel: 'gpt-6-astra',
    })
    expect(keys.indexOf('magpie/gpt-6-astra')).toBeLessThan(keys.indexOf('*/gpt-6-astra'))
  })

  it('去标记候选排在原始名之后、provider 兜底之前', () => {
    const keys = priceKeyCandidates('magpie', 'group/auto-gpt-6-astra')
    expect(keys.indexOf('*/auto-gpt-6-astra')).toBeLessThan(keys.indexOf('*/gpt-6-astra'))
    expect(keys.indexOf('*/gpt-6-astra')).toBeLessThan(keys.indexOf('magpie/*'))
  })
})
