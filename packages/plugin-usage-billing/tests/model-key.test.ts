import { describe, expect, it } from 'vitest'
import { aliasId, normalizeModelId, priceKeyCandidates } from '../src/model-key.ts'
import type { ModelAlias } from '../src/types.ts'

describe('normalizeModelId（内置确定性规则）', () => {
  it('剥组织前缀', () => {
    expect(normalizeModelId('deepseek/deepseek-v4-flash')).toBe('deepseek-v4-flash')
    expect(normalizeModelId('anthropic/claude-sonnet-4')).toBe('claude-sonnet-4')
  })

  it('剥日期后缀（-YYYYMMDD / -YYYY-MM / -YYYYMM）', () => {
    expect(normalizeModelId('deepseek-v4-flash-20260518')).toBe('deepseek-v4-flash')
    expect(normalizeModelId('gpt-4o-2026-05')).toBe('gpt-4o')
    expect(normalizeModelId('claude-sonnet-4-202605')).toBe('claude-sonnet-4')
  })

  it('小写化并去空格', () => {
    expect(normalizeModelId(' DeepSeek-V4-Flash ')).toBe('deepseek-v4-flash')
  })

  it('不改动看不出日期/前缀的 id', () => {
    expect(normalizeModelId('mi-mimo-2.5')).toBe('mi-mimo-2.5')
    expect(normalizeModelId('gpt-4.1-mini')).toBe('gpt-4.1-mini')
  })

  it('不把版本号误当日期', () => {
    expect(normalizeModelId('kimi-k2-0905')).toBe('kimi-k2-0905')
  })
})

describe('priceKeyCandidates（查价档位顺序）', () => {
  it('原始 id 优先，其次规范化，再 provider 兜底与全局兜底', () => {
    expect(priceKeyCandidates('deepseek', 'deepseek-v4-flash-20260518')).toEqual([
      'deepseek/deepseek-v4-flash-20260518',
      'deepseek/deepseek-v4-flash',
      'deepseek/*',
      '*/*',
    ])
  })

  it('手工别名插在规范化之后（可撤销、只影响查价不超过目录）', () => {
    const alias: ModelAlias = {
      id: aliasId('relay', 'hy3'), provider: 'relay', rawModel: 'hy3', canonicalModel: 'deepseek-v4-flash',
    }
    expect(priceKeyCandidates('relay', 'hy3', alias)).toEqual([
      'relay/hy3',
      'relay/deepseek-v4-flash',
      'relay/*',
      '*/*',
    ])
  })

  it('provider 归一化为小写', () => {
    expect(priceKeyCandidates(' DeepSeek ', 'x')[0]).toBe('deepseek/x')
  })

  it('别名 canonicalModel 为空串时忽略', () => {
    const alias: ModelAlias = { id: 'i', provider: 'a', rawModel: 'b', canonicalModel: '' }
    expect(priceKeyCandidates('a', 'b', alias)).toEqual(['a/b', 'a/*', '*/*'])
  })

  it('候选去重后保序', () => {
    const out = priceKeyCandidates('a', 'plain')
    expect(out).toEqual(['a/plain', 'a/*', '*/*'])
  })
})

describe('aliasId（别名存储键归一化）', () => {
  it('两侧都归一化：provider 大小写与两侧空格不影响键', () => {
    expect(aliasId(' Relay ', ' hy3 ')).toBe(aliasId('relay', 'hy3'))
  })
})
