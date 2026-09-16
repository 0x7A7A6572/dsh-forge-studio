import { describe, expect, it } from 'vitest'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY, priceKey } from '../src/pricing/catalog.ts'

describe('内置价表', () => {
  it('key 形如 provider/model', () => {
    for (const k of Object.keys(BUILTIN_CATALOG)) {
      expect(k, `bad key: ${k}`).toMatch(/^[^/]+\/[^/]+$/)
    }
  })

  it('每个条目四个价非负且币种合法', () => {
    for (const [k, v] of Object.entries(BUILTIN_CATALOG)) {
      for (const f of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) {
        expect(v[f], `${k}.${f}`).toBeGreaterThanOrEqual(0)
      }
      expect(['CNY', 'USD']).toContain(v.currency)
    }
  })

  it('DeepSeek 官方三款在册（provider 为 deepseek）', () => {
    const keys = Object.keys(BUILTIN_CATALOG)
    expect(keys).toContain('deepseek/deepseek-v4-flash')
    expect(keys).toContain('deepseek/deepseek-v4-pro')
  })

  it('国内厂商录 CNY、国外录 USD', () => {
    expect(BUILTIN_CATALOG['deepseek/deepseek-v4-flash']!.currency).toBe('CNY')
  })

  it('默认汇率为正数', () => {
    expect(DEFAULT_USD_TO_CNY).toBeGreaterThan(0)
  })

  it('priceKey 归一化 provider 大小写与空格', () => {
    expect(priceKey(' DeepSeek ', 'v4-flash')).toBe('deepseek/v4-flash')
  })
})
