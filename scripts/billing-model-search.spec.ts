/**
 * 「归到哪个模型」下拉候选的筛选/排序门禁（纯函数，无 DOM）。
 */
import { describe, expect, it } from 'vitest'
import { MODEL_OPTION_LIMIT, filterModelOptions, isKnownModelName, type ModelOption } from '../packages/plugin-usage-billing/src/client/views/settings-section/model-search.ts'

const OPTS: ModelOption[] = [
  { key: 'deepseek/deepseek-chat', custom: false },
  { key: 'deepseek/deepseek-v4-flash', custom: false },
  { key: 'ds-hk/some-deepseek-v4-flash-variant', custom: true },
  { key: 'deepseek/deepseek-v4-pro', custom: false },
]

describe('模型下拉候选', () => {
  it('空查询给前若干条，保持原顺序', () => {
    expect(filterModelOptions(OPTS, '').map((o) => o.key)).toEqual(OPTS.map((o) => o.key))
  })

  it('前缀命中排在子串命中之前', () => {
    // 两条模型名前缀命中，第三条是子串命中（some-deepseek-v4-flash-variant）。
    expect(filterModelOptions(OPTS, 'deepseek-v4').map((o) => o.key)).toEqual([
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
      'ds-hk/some-deepseek-v4-flash-variant',
    ])
  })

  it('前缀档也认「provider/」后面的模型名', () => {
    const got = filterModelOptions(OPTS, 'deepseek-v4-flash').map((o) => o.key)
    expect(got[0]).toBe('deepseek/deepseek-v4-flash')
    expect(got).toContain('ds-hk/some-deepseek-v4-flash-variant')
  })

  it('大小写与首尾空格都不敏感', () => {
    const got = filterModelOptions(OPTS, '  DEEPSEEK-V4-FLASH  ').map((o) => o.key)
    expect(got[0]).toBe('deepseek/deepseek-v4-flash')
    expect(got).toContain('ds-hk/some-deepseek-v4-flash-variant')
  })

  it('认得出价表里有没有这个名字（整 key 或裸模型名）', () => {
    expect(isKnownModelName(OPTS, 'deepseek/deepseek-v4-flash')).toBe(true)
    expect(isKnownModelName(OPTS, 'deepseek-v4-flash')).toBe(true)
    expect(isKnownModelName(OPTS, ' DEEPSEEK-V4-PRO ')).toBe(true)
    expect(isKnownModelName(OPTS, 'deepseek-flash')).toBe(false)
    expect(isKnownModelName(OPTS, '')).toBe(true)
  })

  it('子串也能命中', () => {
    expect(filterModelOptions(OPTS, 'flash').map((o) => o.key)).toEqual([
      'deepseek/deepseek-v4-flash',
      'ds-hk/some-deepseek-v4-flash-variant',
    ])
  })

  it('没有就返回空，不兜底塞默认项', () => {
    expect(filterModelOptions(OPTS, 'no-such-model')).toEqual([])
  })

  it('上限是硬截断，且截断后仍保序', () => {
    const many: ModelOption[] = Array.from({ length: 50 }, (_, i) => ({ key: `p/m-${String(i).padStart(2, '0')}`, custom: false }))
    const got = filterModelOptions(many, 'm-')
    expect(got).toHaveLength(MODEL_OPTION_LIMIT)
    expect(got[0]?.key).toBe('p/m-00')
    expect(got[MODEL_OPTION_LIMIT - 1]?.key).toBe('p/m-' + String(MODEL_OPTION_LIMIT - 1).padStart(2, '0'))
  })
})
