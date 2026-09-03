/**
 * 便签列表纯函数：活动/归档分区、主排序、颜色过滤。
 * 全部为纯函数（无副作用、不触 DOM/服务），UI 渲染前的数据整理都走这里。
 */

import type { NoteColor, NoteRecord } from '../../types.ts'

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
