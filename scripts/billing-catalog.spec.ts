/**
 * 内置目录与官网口径的对齐门禁。
 *
 * 背景：内置目录只在联网抓价失败时兜底，抄错一个数量级没人看得出来 ——
 * 官方当前只列两档模型，这里把「高峰时段」价钉进测试（空闲 = 高峰 × 0.5，分时计价另做）。
 */
import { describe, expect, it } from 'vitest'
import { BUILTIN_CATALOG } from '../packages/plugin-usage-billing/src/pricing/catalog.ts'
import type { PriceEntry } from '../packages/plugin-usage-billing/src/types.ts'

/** 官方「高峰时段」价（元 / 百万 token），抓自 api-docs.deepseek.com 定价页。 */
const OFFICIAL_PEAK: Readonly<Record<string, Pick<PriceEntry, 'input' | 'cacheRead' | 'output'>>> = {
  'deepseek/deepseek-flash': { input: 2, cacheRead: 0.04, output: 8 },
  'deepseek/deepseek-v4-pro': { input: 9, cacheRead: 0.3, output: 27 },
}

describe('内置目录的 DeepSeek 价目', () => {
  it('拷官网高峰价：输入 / 缓存命中 / 输出 三项对齐', () => {
    for (const [key, want] of Object.entries(OFFICIAL_PEAK)) {
      const got = BUILTIN_CATALOG[key]
      expect(got, key + ' 未收录').toBeDefined()
      expect({ input: got!.input, cacheRead: got!.cacheRead, output: got!.output }, key).toEqual(want)
      expect(got!.currency, key).toBe('CNY')
    }
  })

  it('任何条目缓存命中价都不得高于未命中价', () => {
    for (const [key, e] of Object.entries(BUILTIN_CATALOG)) {
      expect(e.cacheRead, key).toBeLessThan(e.input)
    }
  })
})
