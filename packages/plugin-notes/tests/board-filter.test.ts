/**
 * core/board-filter 纯函数单测：活动/归档分区、置顶优先+最近更新排序、
 * 颜色多选过滤（空数组 = 不过滤）、文字搜索（标题+正文纯文本）、
 * 懒加载窗口推进（首批 8 / 触底分批）。
 */

import { describe, expect, it } from 'vitest'
import {
  partitionNotes,
  filterNotesByColors,
  sortNotes,
  searchNotes,
  initialWindow,
  nextWindow,
  INITIAL_WINDOW,
  WINDOW_STEP,
} from '../src/client/core/board-filter.ts'
import type { NoteId, NoteRecord } from '../src/types.ts'

function note(partial: Partial<NoteRecord> & { id: string }): NoteRecord {
  return {
    title: 't',
    text: 'b',
    pinned: false,
    archived: false,
    color: 'yellow',
    origin: 'user',
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

describe('searchNotes 文字搜索', () => {
  const notes = [
    note({ id: id('meeting'), title: '周会 Meeting Notes', text: 'agenda 与行动项' }),
    note({ id: id('grocery'), title: '买菜清单', text: '## 超市\n去 **家乐福** 买牛奶' }),
    note({ id: id('idea'), title: '想法', text: 'TODO: 给 [DeepSeek](https://deepseek.com) 写感谢信' }),
  ]

  it('空白/空查询不过滤，保持原顺序', () => {
    expect(searchNotes(notes, '').map((n) => n.id)).toEqual([id('meeting'), id('grocery'), id('idea')])
    expect(searchNotes(notes, '   ').map((n) => n.id)).toEqual([id('meeting'), id('grocery'), id('idea')])
  })

  it('命中标题（不区分大小写）', () => {
    expect(searchNotes(notes, 'meeting').map((n) => n.id)).toEqual([id('meeting')])
    expect(searchNotes(notes, '周会').map((n) => n.id)).toEqual([id('meeting')])
  })

  it('命中正文（Markdown 剥语法后按纯文本匹配）', () => {
    // 「超市」是正文二级标题，剥掉 # 后命中
    expect(searchNotes(notes, '超市').map((n) => n.id)).toEqual([id('grocery')])
    // 「家乐福」在正文加粗里
    expect(searchNotes(notes, '家乐福').map((n) => n.id)).toEqual([id('grocery')])
    // 链接文字「DeepSeek」/「感谢信」在正文链接里
    expect(searchNotes(notes, 'DeepSeek').map((n) => n.id)).toEqual([id('idea')])
    expect(searchNotes(notes, '感谢信').map((n) => n.id)).toEqual([id('idea')])
  })

  it('无命中返回空数组', () => {
    expect(searchNotes(notes, '不存在的内容xyz')).toEqual([])
  })
})

describe('懒加载窗口推进', () => {
  it('initialWindow 首屏各 8 条', () => {
    expect(initialWindow()).toEqual({ active: INITIAL_WINDOW, archived: INITIAL_WINDOW })
    expect(INITIAL_WINDOW).toBe(8)
  })

  it('触底优先补活动区，一次补 WINDOW_STEP 且不越过总数', () => {
    const win = nextWindow(initialWindow(), { active: 30, archived: 0 }, false)
    expect(win.active).toBe(INITIAL_WINDOW + WINDOW_STEP)
    // 只剩 3 条时只补到总数
    const nearEnd = nextWindow({ active: 27, archived: 8 }, { active: 30, archived: 8 }, false)
    expect(nearEnd.active).toBe(30)
  })

  it('活动区展完才补归档区（需展开态）', () => {
    // 归档区收起：活动区展完即停
    const closed = nextWindow({ active: 30, archived: 8 }, { active: 30, archived: 40 }, false)
    expect(closed.archived).toBe(8)
    // 归档区展开：继续补归档区
    const open = nextWindow({ active: 30, archived: 8 }, { active: 30, archived: 40 }, true)
    expect(open.archived).toBe(8 + WINDOW_STEP)
    // 两区都展完：原样返回
    const done = nextWindow({ active: 30, archived: 40 }, { active: 30, archived: 40 }, true)
    expect(done).toEqual({ active: 30, archived: 40 })
  })
})
