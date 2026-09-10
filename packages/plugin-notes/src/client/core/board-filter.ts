/**
 * 便签列表纯函数：活动/归档分区、主排序、颜色过滤、文字搜索、
 * 懒加载窗口推进。全部为纯函数（无副作用、不触 DOM/服务），
 * UI 渲染前的数据整理都走这里。
 */

import type { NoteColor, NoteRecord } from '../../types.ts'
import { mdToPlainText } from './markdown-text.ts'

/** 便签板主排序：置顶优先，其次最近更新在前。 */
export function sortNotes(notes: readonly NoteRecord[]): NoteRecord[] {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  )
}

export interface NotePartition {
  /** 活动便签（未归档），已按主排序整理。 */
  readonly active: readonly NoteRecord[]
  /** 归档便签，同样按主排序整理（最近更新在前）。 */
  readonly archived: readonly NoteRecord[]
}

/** 按 archived 标记分区；两区各自排序。 */
export function partitionNotes(notes: readonly NoteRecord[]): NotePartition {
  const active: NoteRecord[] = []
  const archived: NoteRecord[] = []
  for (const note of notes) {
    ;(note.archived ? archived : active).push(note)
  }
  return { active: sortNotes(active), archived: sortNotes(archived) }
}

/**
 * 颜色过滤：colors 为空数组 = 不过滤（显示全部颜色）。
 * 结果保持传入顺序（调用方先排好序）。
 */
export function filterNotesByColors(
  notes: readonly NoteRecord[],
  colors: readonly NoteColor[],
): NoteRecord[] {
  if (colors.length === 0) return [...notes]
  return notes.filter((note) => colors.includes(note.color))
}

/**
 * 文字搜索：query trim 后为空 = 不过滤；否则按 title 与正文纯文本
 * （剥掉 Markdown 语法标记）做不区分大小写的子串匹配。
 * 结果保持传入顺序。
 */
export function searchNotes(
  notes: readonly NoteRecord[],
  query: string,
): NoteRecord[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...notes]
  return notes.filter(
    (note) =>
      note.title.toLowerCase().includes(q) ||
      mdToPlainText(note.text).toLowerCase().includes(q),
  )
}

/* ---------- 懒加载窗口 ---------- */

/** 首批渲染的条目数。 */
export const INITIAL_WINDOW = 16
/** 触底后每批追加的条目数。 */
export const WINDOW_STEP = 20

export interface LazyWindow {
  /** 活动区已展开条数。 */
  readonly active: number
  /** 归档区已展开条数。 */
  readonly archived: number
}

export function initialWindow(): LazyWindow {
  return { active: INITIAL_WINDOW, archived: INITIAL_WINDOW }
}

/**
 * 触底推进：优先补活动区，活动区展完再补归档区（仅当 archivedOpen 时归档区
 * 才可能被滚动到）。返回新窗口；两区都展完则原样返回。
 */
export function nextWindow(
  win: LazyWindow,
  totals: { readonly active: number; readonly archived: number },
  archivedOpen: boolean,
): LazyWindow {
  if (win.active < totals.active) {
    return { active: Math.min(win.active + WINDOW_STEP, totals.active), archived: win.archived }
  }
  if (archivedOpen && win.archived < totals.archived) {
    return { active: win.active, archived: Math.min(win.archived + WINDOW_STEP, totals.archived) }
  }
  return win
}
