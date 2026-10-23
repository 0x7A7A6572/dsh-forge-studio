/**
 * 定时日程（schedule.ts）与调度器（scheduler.ts）的纯语义测试：
 * 覆盖 endAt 有效期字段的校验、签名、到期判定与 tick 闸门。
 */
import { describe, expect, it } from 'vitest'
import {
  applyScheduleExpired,
  isScheduleExpired,
  makeSchedule,
  previewNextAt,
  sanitizeSchedule,
  scheduleSignature,
} from '../packages/plugin-notes/src/schedule.ts'
import { createScheduleRunner } from '../packages/plugin-notes/src/scheduler.ts'
import type { NoteId, NoteRecord, NoteSchedule, NoteScheduleInput } from '../packages/plugin-notes/src/types.ts'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

function noteWith(schedule: NoteSchedule): NoteRecord {
  return {
    id: 'n1' as NoteId,
    title: 't',
    text: 'body',
    pinned: false,
    archived: false,
    color: 'yellow',
    origin: 'user',
    lane: { status: 'todo' },
    schedule,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
  }
}

describe('sanitizeSchedule —— endAt 有效期', () => {
  it('合法 endAt 原样保留', () => {
    const out = sanitizeSchedule({ enabled: true, mode: 'daily', time: '09:00', nextAt: 0, endAt: NOW + DAY })
    expect(out?.endAt).toBe(NOW + DAY)
  })

  it('非法 endAt（NaN）丢弃而非报错', () => {
    const out = sanitizeSchedule({ enabled: true, mode: 'daily', time: '09:00', nextAt: 0, endAt: Number.NaN })
    expect(out?.endAt).toBeUndefined()
  })
})

describe('scheduleSignature —— endAt 参与签名', () => {
  const base: NoteScheduleInput = { enabled: true, mode: 'daily', time: '09:00', nextAt: 0 }

  it('仅 endAt 不同 → 签名不同（保存时会发出 patch）', () => {
    expect(scheduleSignature({ ...base, endAt: NOW })).not.toBe(scheduleSignature(base))
  })

  it('endAt 缺省与显式 undefined 签名一致', () => {
    expect(scheduleSignature({ ...base, endAt: undefined })).toBe(scheduleSignature(base))
  })
})

describe('isScheduleExpired / applyScheduleExpired', () => {
  const daily = (endAt?: number): NoteSchedule => ({
    enabled: true,
    mode: 'daily',
    time: '09:00',
    nextAt: NOW,
    ...(endAt !== undefined ? { endAt } : {}),
  })

  it('endAt 已过 → 到期；未到 / 缺省 / 0 → 未到期', () => {
    expect(isScheduleExpired(daily(NOW - 1), NOW)).toBe(true)
    expect(isScheduleExpired(daily(NOW), NOW)).toBe(true)
    expect(isScheduleExpired(daily(NOW + 1), NOW)).toBe(false)
    expect(isScheduleExpired(daily(), NOW)).toBe(false)
    expect(isScheduleExpired(daily(0), NOW)).toBe(false)
  })

  it('停用写回：enabled=false + 中文 lastResult，其余字段保留', () => {
    const out = applyScheduleExpired({ ...daily(NOW - 1), runCount: 3 })
    expect(out.enabled).toBe(false)
    expect(out.lastResult).toBe('已到有效期，自动停用')
    expect(out.runCount).toBe(3)
    expect(out.mode).toBe('daily')
  })
})

describe('makeSchedule / previewNextAt —— 有效期交互', () => {
  it('切模式保留 previous.endAt', () => {
    const out = makeSchedule('weekly', { enabled: true, mode: 'daily', time: '09:00', nextAt: 0, endAt: NOW + DAY })
    expect(out.endAt).toBe(NOW + DAY)
    expect(out.mode).toBe('weekly')
  })

  it('下次触发晚于 endAt → 预览为空（不会再跑）', () => {
    expect(previewNextAt({ enabled: true, mode: 'daily', time: '09:00', nextAt: NOW, endAt: NOW - 1 }, NOW)).toBeUndefined()
    expect(previewNextAt({ enabled: true, mode: 'daily', time: '09:00', nextAt: NOW, endAt: NOW }, NOW)).toBe(NOW)
  })
})

describe('调度器 tick —— 有效期闸门', () => {
  function runnerFor(notes: readonly NoteRecord[]) {
    const executed: string[] = []
    const writes: Array<{ id: string; schedule: NoteSchedule | undefined }> = []
    const runner = createScheduleRunner({
      list: () => notes,
      execute: async (id) => {
        executed.push(id)
        return { ok: true, note: notes[0]! }
      },
      write: async (id, schedule) => {
        writes.push({ id, schedule })
      },
      settle: async () => {},
      warn: () => {},
    })
    return { runner, executed, writes }
  }

  it('enabled + 已过期 → 写停用、不派发', async () => {
    const { runner, executed, writes } = runnerFor([
      noteWith({ enabled: true, mode: 'daily', time: '09:00', nextAt: NOW, endAt: NOW - 1 }),
    ])
    await runner.run(NOW)
    expect(executed).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0]!.schedule?.enabled).toBe(false)
    expect(writes[0]!.schedule?.lastResult).toBe('已到有效期，自动停用')
  })

  it('enabled + 未过期 + 到点 → 正常派发（有效期不影响既有链路）', async () => {
    const { runner, executed } = runnerFor([
      noteWith({ enabled: true, mode: 'daily', time: '09:00', nextAt: NOW, endAt: NOW + DAY }),
    ])
    await runner.run(NOW)
    expect(executed).toEqual(['n1'])
  })

  it('已停用 + 已过期 → 不重写（避免每轮空写）', async () => {
    const { runner, executed, writes } = runnerFor([
      noteWith({ enabled: false, mode: 'daily', time: '09:00', nextAt: NOW, endAt: NOW - 1 }),
    ])
    await runner.run(NOW)
    expect(executed).toEqual([])
    expect(writes).toHaveLength(0)
  })
})
