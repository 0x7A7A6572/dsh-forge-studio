/**
 * core/board-filter 纯函数单测：活动/归档分区、置顶优先+最近更新排序、
 * 颜色多选过滤（空数组 = 不过滤）。
 */

import { describe, expect, it } from 'vitest'
import { partitionNotes, filterNotesByColors, sortNotes } from '../src/client/core/board-filter.ts'
import type { NoteId, NoteRecord } from '../src/types.ts'

function note(partial: Partial<NoteRecord> & { id: string }): NoteRecord {
  return {
    title: 't',
    text: 'b',
    pinned: false,
    archived: false,
    color: 'yellow',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const id = (n: string) => n as NoteId

describe('board-filter 纯函数', () => {
  it('partitionNotes 按 archived 分区', () => {
    const a = note({ id: id('a') })
    const b = note({ id: id('b'), archived: true })
    const c = note({ id: id('c') })
    const { active, archived } = partitionNotes([a, b, c])
    expect(active.map((n) => n.id)).toEqual([id('a'), id('c')])
    expect(archived.map((n) => n.id)).toEqual([id('b')])
  })

  it('sortNotes 置顶优先、同层按 updatedAt 降序', () => {
    const old = note({ id: id('old'), updatedAt: 1 })
    const pinned = note({ id: id('pinned'), pinned: true, updatedAt: 5 })
    const newer = note({ id: id('newer'), updatedAt: 9 })
    const sorted = sortNotes([old, pinned, newer])
    expect(sorted.map((n) => n.id)).toEqual([id('pinned'), id('newer'), id('old')])
  })

  it('partition 的活动区已按主排序整理', () => {
    const old = note({ id: id('old'), updatedAt: 1 })
    const pinned = note({ id: id('pinned'), pinned: true, updatedAt: 5 })
    const { active } = partitionNotes([old, pinned])
    expect(active.map((n) => n.id)).toEqual([id('pinned'), id('old')])
  })

  it('颜色过滤：空数组不过滤，选中色只留匹配', () => {
    const y = note({ id: id('y'), color: 'yellow' })
    const p = note({ id: id('p'), color: 'pink' })
    const g = note({ id: id('g'), color: 'green' })
    expect(filterNotesByColors([y, p, g], []).map((n) => n.id)).toEqual([id('y'), id('p'), id('g')])
    expect(filterNotesByColors([y, p, g], ['yellow', 'green']).map((n) => n.id)).toEqual([id('y'), id('g')])
    expect(filterNotesByColors([y, p, g], ['blue'])).toEqual([])
  })

  it('颜色过滤保持输入顺序（不重排）', () => {
    const g = note({ id: id('g'), color: 'green' })
    const y = note({ id: id('y'), color: 'yellow' })
    expect(filterNotesByColors([g, y], ['yellow', 'green']).map((n) => n.id)).toEqual([id('g'), id('y')])
  })
})
