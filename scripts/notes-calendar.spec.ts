/**
 * 日历数据层门禁：截止、日程触发（下一次 + 未来重复投影）、执行历史都要摊到日桶里，
 * 且归档便签不进日历、历史重复帧不能重复计数。
 */
import { describe, expect, it } from 'vitest'
import {
  collectEvents,
  groupEventsByDay,
} from '../packages/plugin-notes/src/client/core/calendar-month.ts'
import { dayKey } from '../packages/plugin-notes/src/client/core/due-date.ts'
import type { NoteRecord, NoteRun, NoteSchedule } from '../packages/plugin-notes/src/types.ts'

function note(partial: Partial<NoteRecord>): NoteRecord {
  return {
    id: 'n1' as NoteRecord['id'],
    title: '任务',
    text: '',
    pinned: false,
    archived: false,
    color: 'yellow',
    origin: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as NoteRecord
}

const daily: NoteSchedule = {
  enabled: true,
  mode: 'daily',
  time: '09:30',
  nextAt: Date.now() + 60 * 60 * 1000,
}

const run = (startedAt: number, ok: boolean): NoteRun => ({
  startedAt,
  finishedAt: startedAt + 1000,
  ok,
  by: 'schedule',
})

describe('collectEvents', () => {
  it('截止与日程都进事项，重复日程投影出未来多次', () => {
    const events = collectEvents([note({ dueAt: Date.now() + 1000, schedule: daily })])
    expect(events.filter((event) => event.kind === 'due')).toHaveLength(1)
    const scheduleEvents = events.filter((event) => event.kind === 'schedule')
    expect(scheduleEvents.length).toBeGreaterThan(1)
    expect(scheduleEvents[0]?.at).toBe(daily.nextAt)
    for (let i = 1; i < scheduleEvents.length; i += 1) {
      expect(scheduleEvents[i]!.at).toBeGreaterThan(scheduleEvents[i - 1]!.at)
    }
  })

  it('interval 日程只显示下一次（不做密集投影）', () => {
    const interval: NoteSchedule = {
      enabled: true,
      mode: 'interval',
      everyMin: 5,
      nextAt: Date.now() + 60_000,
    }
    const scheduleEvents = collectEvents([note({ schedule: interval })]).filter(
      (event) => event.kind === 'schedule',
    )
    expect(scheduleEvents).toHaveLength(1)
  })

  it('执行历史按 startedAt 落桶，当前 run 与历史重复时只算一次', () => {
    const first = run(1000, true)
    const second = run(2000, false)
    const events = collectEvents([
      note({ lane: { status: 'done', run: second, runs: [first, second] } }),
    ])
    const runEvents = events.filter((event) => event.kind === 'run')
    expect(runEvents).toHaveLength(2)
    expect(runEvents.map((event) => event.ok)).toEqual([true, false])
    expect(runEvents[0]?.at).toBe(1000)
  })

  it('归档便签不产生任何事项', () => {
    const events = collectEvents([
      note({ archived: true, dueAt: 1000, schedule: daily, lane: { status: 'done', runs: [run(1, true)] } }),
    ])
    expect(events).toEqual([])
  })

  it('同日事项按时刻升序分组', () => {
    const day = new Date(2026, 0, 5, 10, 0, 0).getTime()
    const events = collectEvents([
      note({ id: 'a' as NoteRecord['id'], dueAt: day + 1000 }),
      note({
        id: 'b' as NoteRecord['id'],
        lane: { status: 'done', runs: [{ startedAt: day, finishedAt: day + 5, ok: true }] },
      }),
    ])
    const byDay = groupEventsByDay(events)
    const bucket = byDay.get(dayKey(day)) ?? []
    expect(bucket.length).toBeGreaterThanOrEqual(2)
    expect(bucket[0]!.at).toBeLessThanOrEqual(bucket[1]!.at)
  })
})
