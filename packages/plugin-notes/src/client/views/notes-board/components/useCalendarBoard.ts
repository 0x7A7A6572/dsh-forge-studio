/**
 * 日历视图的状态：月份游标、选中日、按日分桶的事项。
 * 事项只来自活动便签（归档不进日历），颜色/搜索筛选由上游 BoardMain 先做掉。
 */

import { useMemo, useState } from 'react'
import type { NoteRecord } from '../../../../types.ts'
import {
  WEEKDAY_LABELS,
  collectEvents,
  groupEventsByDay,
  monthCells,
  monthLabel,
  monthOf,
  shiftMonth,
  type CalendarCell,
  type CalendarEvent,
  type MonthCursor,
} from '../../../core/calendar-month.ts'
import { dayKey } from '../../../core/due-date.ts'

export interface UseCalendarBoardOptions {
  readonly notes: readonly NoteRecord[]
  readonly onEdit: (note: NoteRecord) => void
}

export interface UseCalendarBoardResult {
  readonly cursor: MonthCursor
  readonly label: string
  readonly cells: readonly CalendarCell[]
  readonly weekdays: readonly string[]
  readonly selectedKey: string
  readonly selectedEvents: readonly CalendarEvent[]
  readonly monthEventCount: number
  readonly eventsByDay: ReadonlyMap<string, readonly CalendarEvent[]>
  readonly selectDay: (key: string) => void
  readonly goPrev: () => void
  readonly goNext: () => void
  readonly goToday: () => void
  readonly openNote: (note: NoteRecord) => void
}

export function useCalendarBoard(options: UseCalendarBoardOptions): UseCalendarBoardResult {
  const now = Date.now()
  const [cursor, setCursor] = useState<MonthCursor>(() => monthOf(now))
  const [selectedKey, setSelectedKey] = useState(() => dayKey(now))

  const events = useMemo(() => collectEvents(options.notes), [options.notes])
  const eventsByDay = useMemo(() => groupEventsByDay(events), [events])
  const cells = useMemo(() => monthCells(cursor, now), [cursor, now])
  const monthEventCount = useMemo(
    () =>
      cells.filter(
        (cell) => cell.inMonth && (eventsByDay.get(cell.key)?.length ?? 0) > 0,
      ).length,
    [cells, eventsByDay],
  )

  /** 切月时把选中日挪到该月第一个有事项的日子（没有就 1 号）。 */
  function moveMonth(delta: number): void {
    const next = shiftMonth(cursor, delta)
    setCursor(next)
    const firstHit = monthCells(next, now).find(
      (cell) => cell.inMonth && (eventsByDay.get(cell.key)?.length ?? 0) > 0,
    )
    setSelectedKey(firstHit?.key ?? dayKey(new Date(next.year, next.month, 1).getTime()))
  }

  return {
    cursor,
    label: monthLabel(cursor),
    cells,
    weekdays: WEEKDAY_LABELS,
    selectedKey,
    selectedEvents: eventsByDay.get(selectedKey) ?? [],
    monthEventCount,
    eventsByDay,
    selectDay: setSelectedKey,
    goPrev: () => moveMonth(-1),
    goNext: () => moveMonth(1),
    goToday: () => {
      setCursor(monthOf(now))
      setSelectedKey(dayKey(now))
    },
    openNote: options.onEdit,
  }
}
