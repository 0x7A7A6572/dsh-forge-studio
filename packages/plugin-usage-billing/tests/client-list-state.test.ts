/**
 * 列表逻辑单测：过滤 / 排序 / 分页都在这一层，界面只负责摆按钮。
 *
 * 三条被钉住的行为都是真实会出错的边界：
 * - 非有限数字（未收录的占位）沉底，不占据排序榜首。
 * - 过滤后页码必须回落 —— 否则用户会停在一张空表上。
 * - 页数按**过滤后**的行数算，不是原始行数。
 */

import { describe, expect, it } from 'vitest'
import {
  buildListView, clampPage, matchesQuery, normalizeQuery, pageCount, pageRows, sortRows,
} from '../src/client/core/list-state.ts'

interface Row { name: string; cost: number }

const value = (row: Row, key: string): number | string => key === 'cost' ? row.cost : row.name

const rows: Row[] = [
  { name: 'b-model', cost: 30 },
  { name: 'a-model', cost: 10 },
  { name: 'c-model', cost: Number.NaN },
]

describe('matchesQuery', () => {
  it('去空白 + 大小写不敏感；空查询恒命中', () => {
    expect(normalizeQuery('  DeepSeek ')).toBe('deepseek')
    expect(matchesQuery('deepseek-v4', '  V4 ')).toBe(true)
    expect(matchesQuery('deepseek-v4', '')).toBe(true)
    expect(matchesQuery('deepseek-v4', 'qwen')).toBe(false)
  })
})

describe('sortRows', () => {
  it('按数字升 / 降序', () => {
    expect(sortRows(rows, { key: 'cost', dir: 'asc' }, value).map((r) => r.cost)).toEqual([10, 30, Number.NaN])
    expect(sortRows(rows, { key: 'cost', dir: 'desc' }, value).map((r) => r.cost)).toEqual([30, 10, Number.NaN])
  })

  it('NaN / Infinity 沉底：它们不是「大」也不是「小」，不该抢榜首', () => {
    // 降序时最容易错：把 NaN 当 0 或当「最大」都会让它排到前面。
    expect(sortRows(rows, { key: 'cost', dir: 'desc' }, value)[2]!.name).toBe('c-model')
    expect(sortRows(rows, { key: 'cost', dir: 'asc' }, value)[2]!.name).toBe('c-model')
  })

  it('按字符串排（中文用本地化比较）', () => {
    expect(sortRows(rows, { key: 'name', dir: 'asc' }, value).map((r) => r.name))
      .toEqual(['a-model', 'b-model', 'c-model'])
  })

  it('sort 为 null 时保持原始顺序（不原地改数组）', () => {
    const input = [...rows]
    expect(sortRows(input, null, value)).toEqual(input)
    expect(input).toEqual(rows)
  })
})

describe('分页', () => {
  it('页数按行数算，至少 1 页', () => {
    expect(pageCount(0, 10)).toBe(1)
    expect(pageCount(10, 10)).toBe(1)
    expect(pageCount(11, 10)).toBe(2)
    expect(pageCount(25, 10)).toBe(3)
  })

  it('clampPage 把越界页码夹回最后一页（过滤后必然遇到）', () => {
    expect(clampPage(0, 25, 10)).toBe(1)
    expect(clampPage(3, 25, 10)).toBe(3)
    expect(clampPage(9, 25, 10)).toBe(3)
    expect(clampPage(Number.NaN, 25, 10)).toBe(1)
  })

  it('pageRows 切出当页', () => {
    expect(pageRows([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4])
    expect(pageRows([1, 2, 3], 5, 2)).toEqual([3])
  })
})

describe('buildListView', () => {
  // 注意别用会互相命中的词：'gamma' 里也有 'a'，用 'ap' 才是干净的 2 命中。
  const view = (query: string, page = 1, sort: { key: string; dir: 'asc' | 'desc' } | null = null) =>
    buildListView({
      rows: [{ name: 'apple', cost: 1 }, { name: 'apricot', cost: 2 }, { name: 'banana', cost: 3 }],
      query,
      searchText: (r) => r.name,
      sort,
      sortValue: value,
      page,
      size: 2,
    })

  it('过滤 → 排序 → 分页，页数按过滤后的行数算', () => {
    const all = view('')
    expect(all.total).toBe(3)
    expect(all.filtered).toBe(3)
    expect(all.pages).toBe(2)
    const hit = view('ap')
    expect(hit.total).toBe(3)
    expect(hit.filtered).toBe(2)
    // 命中 2 行 → 只有 1 页（按过滤后算），第 2 页不该存在。
    expect(hit.pages).toBe(1)
  })

  it('到达时页码就已被夹紧：调用方不该拿到一张空表', () => {
    const stalled = view('ap', 3)
    expect(stalled.page).toBe(1)
    expect(stalled.rows.map((r) => r.name)).toEqual(['apple', 'apricot'])
  })

  it('没有 searchText 时不过滤（但排序分页照做）', () => {
    const v = buildListView({
      rows: [{ name: 'b', cost: 2 }, { name: 'a', cost: 1 }],
      query: 'zzz',
      sort: { key: 'cost', dir: 'asc' },
      sortValue: value,
      page: 1,
      size: 10,
    })
    expect(v.filtered).toBe(2)
    expect(v.rows.map((r) => r.name)).toEqual(['a', 'b'])
  })
})
