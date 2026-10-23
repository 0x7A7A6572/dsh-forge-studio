/**
 * 日历的纯数据层：月网格（周一起始，恒 6 行）+ 便签摊成「日 → 事项」。
 * 事项来自 dueAt（截止）与 schedule.nextAt（定时）。
 */

import type { NoteRecord } from '../../types.ts'
import { dayKey } from './due-date.ts'

export interface MonthCursor {
  /** 0-11。 */
  readonly month: number
  readonly year: number
}

export interface CalendarCell {
  readonly day: number
  /** 是否属于当前月（相邻月的填充格为 false）。 */
  readonly inMonth: boolean
  readonly key: string
  readonly ts: number
  readonly today: boolean
}

export type CalendarEventKind = 'due' | 'schedule'

export interface CalendarEvent {
  readonly at: number
  readonly kind: CalendarEventKind
  readonly note: NoteRecord
}

/** 月网格行数：固定 6 行，避免月份切换时行高跳动。 */
const ROWS = 6
const COLS = 7

export function monthOf(ts: number): MonthCursor {
  const d = new Date(ts)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const d = new Date(cursor.year, cursor.month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function monthLabel(cursor: MonthCursor): string {
  return `${cursor.year} 年 ${cursor.month + 1} 月`
}

/** 周一起始的 42 格；首格可能落在上月。 */
export function monthCells(cursor: MonthCursor, now: number): CalendarCell[] {
  const first = new Date(cursor.year, cursor.month, 1)
  const offset = (first.getDay() + 6) % 7
  const todayKey = dayKey(now)
  const cells: CalendarCell[] = []
  for (let i = 0; i < ROWS * COLS; i += 1) {
    const d = new Date(cursor.year, cursor.month, 1 - offset + i)
    const key = dayKey(d.getTime())
    cells.push({
      key,
      ts: d.getTime(),
      day: d.getDate(),
      inMonth: d.getMonth() === cursor.month,
      today: key === todayKey,
    })
  }
  return cells
}

/** 周标签（周一起始）。 */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** 一张便签可能同时产生两条事项（截止 + 定时）。 */
export function collectEvents(notes: readonly NoteRecord[]): CalendarEvent[] {
  const events: CalendarEvent[] = []
  for (const note of notes) {
    if (note.archived) continue
    if (note.dueAt !== undefined) events.push({ note, kind: 'due', at: note.dueAt })
    const nextAt = note.schedule?.nextAt
    if (note.schedule?.enabled === true && nextAt !== undefined && nextAt > 0) {
      events.push({ note, kind: 'schedule', at: nextAt })
    }
  }
  return events.sort((a, b) => a.at - b.at)
}

/** 按日键分桶；同日按时刻升序。 */
export function groupEventsByDay(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const key = dayKey(event.at)
    const bucket = byDay.get(key)
    if (bucket === undefined) byDay.set(key, [event])
    else bucket.push(event)
  }
  return byDay
}

/** 某月（含首尾填充日）内的事项数，用于月切换时的总量提示。 */
export function countEventsInMonth(events: readonly CalendarEvent[], cursor: MonthCursor): number {
  let total = 0
  for (const event of events) {
    const d = new Date(event.at)
    if (d.getFullYear() === cursor.year && d.getMonth() === cursor.month) total += 1
  }
  return total
}
