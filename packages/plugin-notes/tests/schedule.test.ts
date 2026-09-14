/**
 * 定时日程纯语义单测（schedule.ts）：排程算法、入参校验、派发结果写回、到期判定。
 * 时间用本地时区构造（new Date(y, m-1, d, h, min)），与实现一致，避免时区假失败。
 */

import { describe, expect, it } from 'vitest'
import {
  ONCE_STALE_MS,
  SCHEDULE_MAX_FAILURES,
  SCHEDULE_RETRY_MS,
  applyRunResult,
  applyScheduleDispatch,
  applyScheduleSkip,
  armSchedule,
  fromLocalDateTimeInput,
  isNoteScheduleDue,
  isOnceStale,
  isScheduleBlockedStatus,
  makeSchedule,
  nextFireAt,
  parseTimeOfDay,
  pickDueNotes,
  previewNextAt,
  sanitizeSchedule,
  scheduleBlockTextFor,
  scheduleBlockReason,
  scheduleLabel,
  scheduleSignature,
  toLocalDateTimeInput,
} from '../src/schedule.ts'
import type { NoteId, NoteRecord, NoteSchedule, NoteScheduleInput, TaskStatus } from '../src/types.ts'

/** 本地时刻构造：at(2026, 1, 5, 9, 0) = 2026-01-05 09:00（2026-01-05 是周一）。 */
function at(year: number, month: number, day: number, hours = 0, minutes = 0): number {
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime()
}

function schedule(input: Partial<NoteSchedule> & { readonly mode: NoteSchedule['mode'] }): NoteSchedule {
  return { enabled: true, nextAt: 0, ...input } as NoteSchedule
}

function note(input: {
  readonly id?: string
  readonly lane?: boolean
  readonly archived?: boolean
  readonly schedule?: NoteSchedule
  readonly status?: TaskStatus
}): NoteRecord {
  return {
    id: (input.id ?? 'n1') as NoteId,
    title: 't',
    text: '',
    pinned: false,
    archived: input.archived ?? false,
    color: 'yellow',
    origin: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...(input.lane === false ? {} : { lane: { status: input.status ?? ('todo' as const) } }),
    ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
  }
}

describe('parseTimeOfDay', () => {
  it('接受 HH:mm 与 H:mm', () => {
    expect(parseTimeOfDay('09:30')).toEqual({ hours: 9, minutes: 30 })
    expect(parseTimeOfDay('9:05')).toEqual({ hours: 9, minutes: 5 })
    expect(parseTimeOfDay(' 23:59 ')).toEqual({ hours: 23, minutes: 59 })
  })

  it('拒绝越界/形状不符', () => {
    expect(parseTimeOfDay('24:00')).toBeUndefined()
    expect(parseTimeOfDay('09:60')).toBeUndefined()
    expect(parseTimeOfDay('9')).toBeUndefined()
    expect(parseTimeOfDay('')).toBeUndefined()
    expect(parseTimeOfDay('09:3')).toBeUndefined()
  })
})

describe('nextFireAt', () => {
  it('once：未来时刻原样返回，已过期 → undefined', () => {
    const target = at(2026, 1, 5, 9, 0)
    expect(nextFireAt(schedule({ mode: 'once', at: target }), target - 1000)).toBe(target)
    expect(nextFireAt(schedule({ mode: 'once', at: target }), target)).toBeUndefined()
  })

  it('interval：锚定上次排定的 nextAt，闭式跳到严格晚于 from 的一格', () => {
    const base = at(2026, 1, 5, 9, 0)
    const s = schedule({ mode: 'interval', everyMin: 30, nextAt: base })
    expect(nextFireAt(s, base - 1)).toBe(base)
    expect(nextFireAt(s, base)).toBe(base + 30 * 60_000)
    // 宿主停机 95 分钟：一步跳到 base+120min（不补跑中间那几格）。
    expect(nextFireAt(s, base + 95 * 60_000)).toBe(base + 120 * 60_000)
  })

  it('interval：无有效锚点时从 from 起算', () => {
    const from = at(2026, 1, 5, 9, 0)
    expect(nextFireAt(schedule({ mode: 'interval', everyMin: 15, nextAt: 0 }), from)).toBe(from + 15 * 60_000)
  })

  it('interval：everyMin 非法 → undefined', () => {
    expect(nextFireAt(schedule({ mode: 'interval', everyMin: 0, nextAt: 0 }), 1000)).toBeUndefined()
    expect(nextFireAt(schedule({ mode: 'interval', nextAt: 0 }), 1000)).toBeUndefined()
  })

  it('daily：当天时刻未过 → 今天；已过 → 明天', () => {
    const s = schedule({ mode: 'daily', time: '09:00' })
    expect(nextFireAt(s, at(2026, 1, 5, 8, 0))).toBe(at(2026, 1, 5, 9, 0))
    expect(nextFireAt(s, at(2026, 1, 5, 10, 0))).toBe(at(2026, 1, 6, 9, 0))
  })

  it('weekly：只落在指定星期（周一/周三）', () => {
    const s = schedule({ mode: 'weekly', time: '09:00', weekdays: [1, 3] })
    // 周一 10:00 → 周三 09:00；周三 10:00 → 下周一 09:00。
    expect(nextFireAt(s, at(2026, 1, 5, 10, 0))).toBe(at(2026, 1, 7, 9, 0))
    expect(nextFireAt(s, at(2026, 1, 7, 10, 0))).toBe(at(2026, 1, 12, 9, 0))
    expect(nextFireAt(schedule({ mode: 'weekly', time: '09:00', weekdays: [] }), 0)).toBeUndefined()
  })

  it('monthly：当月不足该日时落在当月最后一天', () => {
    const s = schedule({ mode: 'monthly', time: '09:00', monthDay: 31 })
    // 2026 年 2 月只有 28 天 → 2/28 09:00；3 月回到 31 日。
    expect(nextFireAt(s, at(2026, 2, 1, 0, 0))).toBe(at(2026, 2, 28, 9, 0))
    expect(nextFireAt(s, at(2026, 2, 28, 10, 0))).toBe(at(2026, 3, 31, 9, 0))
  })
})

describe('sanitizeSchedule / armSchedule', () => {
  it('按模式校验必填参数，非法 → undefined', () => {
    expect(sanitizeSchedule({ enabled: true, mode: 'once' })).toBeUndefined()
    expect(sanitizeSchedule({ enabled: true, mode: 'interval', everyMin: 0 })).toBeUndefined()
    expect(sanitizeSchedule({ enabled: true, mode: 'daily', time: '9点' })).toBeUndefined()
    expect(sanitizeSchedule({ enabled: true, mode: 'weekly', time: '09:00', weekdays: [] })).toBeUndefined()
    expect(sanitizeSchedule({ enabled: true, mode: 'monthly', time: '09:00', monthDay: 32 })).toBeUndefined()
  })

  it('星期去重并排序，越界项被丢弃', () => {
    const parsed = sanitizeSchedule({ enabled: true, mode: 'weekly', time: '09:00', weekdays: [5, 1, 1, 9, -1, 3] })
    expect(parsed?.weekdays).toEqual([1, 3, 5])
  })

  it('armSchedule：interval 从 from 重算（不吃过期锚点），once 用 at', () => {
    const from = at(2026, 1, 5, 9, 0)
    const armed = armSchedule(
      { enabled: true, mode: 'interval', everyMin: 30, nextAt: from - 10 * 60_000 },
      from,
    )
    expect(armed?.nextAt).toBe(from + 30 * 60_000)
    expect(armSchedule({ enabled: true, mode: 'once', at: from + 60_000 }, from)?.nextAt).toBe(from + 60_000)
  })

  it('armSchedule：停用的日程原样保留（nextAt 缺失补 0）', () => {
    const armed = armSchedule({ enabled: false, mode: 'daily', time: '09:00' }, 123)
    expect(armed).toEqual({ enabled: false, mode: 'daily', time: '09:00', nextAt: 0 })
  })
})

describe('scheduleSignature', () => {
  it('忽略 host 自有的 nextAt/lastFiredAt/lastResult', () => {
    const a: NoteScheduleInput = { enabled: true, mode: 'daily', time: '09:00' }
    const b: NoteSchedule = { enabled: true, mode: 'daily', time: '09:00', nextAt: 999, lastResult: '已派发' }
    expect(scheduleSignature(a)).toBe(scheduleSignature(b))
    expect(scheduleSignature(undefined)).toBe('')
  })

  it('可写字段变了签名就变', () => {
    const a: NoteScheduleInput = { enabled: true, mode: 'daily', time: '09:00' }
    const b: NoteScheduleInput = { enabled: true, mode: 'daily', time: '10:00' }
    const c: NoteScheduleInput = { enabled: false, mode: 'daily', time: '09:00' }
    expect(scheduleSignature(a)).not.toBe(scheduleSignature(b))
    expect(scheduleSignature(a)).not.toBe(scheduleSignature(c))
  })
})

describe('输入控件换算', () => {
  it('datetime-local 值往返一致（分钟精度）', () => {
    const ts = at(2026, 1, 5, 9, 30)
    expect(toLocalDateTimeInput(ts)).toBe('2026-01-05T09:30')
    expect(fromLocalDateTimeInput('2026-01-05T09:30')).toBe(ts)
    expect(fromLocalDateTimeInput('')).toBeUndefined()
    expect(fromLocalDateTimeInput('乱七八糟')).toBeUndefined()
  })

  it('makeSchedule 给每种模式合理默认值', () => {
    const now = at(2026, 1, 5, 9, 0)
    expect(makeSchedule('once', undefined, now)).toEqual({ enabled: true, mode: 'once', at: now + 60 * 60_000 })
    expect(makeSchedule('interval', undefined, now)).toEqual({ enabled: true, mode: 'interval', everyMin: 30 })
    expect(makeSchedule('daily', undefined, now)).toEqual({ enabled: true, mode: 'daily', time: '09:00' })
    expect(makeSchedule('weekly', undefined, now)).toEqual({ enabled: true, mode: 'weekly', time: '09:00', weekdays: [1] })
    expect(makeSchedule('monthly', undefined, now)).toEqual({ enabled: true, mode: 'monthly', time: '09:00', monthDay: 1 })
  })

  it('makeSchedule 保留上一份草稿里可复用的值', () => {
    const now = at(2026, 1, 5, 9, 0)
    const prev: NoteScheduleInput = { enabled: true, mode: 'weekly', time: '20:15', weekdays: [2, 4] }
    expect(makeSchedule('weekly', prev, now).time).toBe('20:15')
    expect(makeSchedule('weekly', prev, now).weekdays).toEqual([2, 4])
    expect(makeSchedule('monthly', prev, now).time).toBe('20:15')
  })

  it('previewNextAt：有权威 nextAt 用它，没有则试算，停用 → undefined', () => {
    const now = at(2026, 1, 5, 8, 0)
    expect(previewNextAt({ enabled: true, mode: 'daily', time: '09:00', nextAt: 777 }, now)).toBe(777)
    expect(previewNextAt({ enabled: true, mode: 'daily', time: '09:00' }, now)).toBe(at(2026, 1, 5, 9, 0))
    expect(previewNextAt({ enabled: false, mode: 'daily', time: '09:00' }, now)).toBeUndefined()
  })
})

describe('scheduleLabel', () => {
  it('各模式的中文摘要', () => {
    expect(scheduleLabel(schedule({ mode: 'once', at: at(2026, 1, 5, 9, 0) }))).toBe('一次性 2026-01-05 09:00')
    expect(scheduleLabel(schedule({ mode: 'interval', everyMin: 30 }))).toBe('每 30 分钟')
    expect(scheduleLabel(schedule({ mode: 'interval', everyMin: 120 }))).toBe('每 2 小时')
    expect(scheduleLabel(schedule({ mode: 'daily', time: '09:00' }))).toBe('每天 09:00')
    expect(scheduleLabel(schedule({ mode: 'weekly', time: '09:00', weekdays: [1, 3] }))).toBe('每周一、周三 09:00')
    expect(scheduleLabel(schedule({ mode: 'monthly', time: '09:00', monthDay: 1 }))).toBe('每月 1 日 09:00')
    expect(scheduleLabel(undefined)).toBe('')
  })
})

describe('到期判定', () => {
  it('启用 + 未归档 + 是任务 + nextAt 已到才到期', () => {
    const due = note({ schedule: schedule({ mode: 'daily', time: '09:00', nextAt: 1000 }) })
    expect(isNoteScheduleDue(due, 1000)).toBe(true)
    expect(isNoteScheduleDue(due, 999)).toBe(false)
    expect(isNoteScheduleDue(note({ schedule: schedule({ mode: 'daily', time: '09:00', nextAt: 1000, enabled: false }) }), 1000)).toBe(false)
    expect(isNoteScheduleDue(note({ archived: true, schedule: schedule({ mode: 'daily', time: '09:00', nextAt: 1000 }) }), 1000)).toBe(false)
    expect(isNoteScheduleDue(note({ lane: false, schedule: schedule({ mode: 'daily', time: '09:00', nextAt: 1000 }) }), 1000)).toBe(false)
    expect(isNoteScheduleDue(note({}), 1000)).toBe(false)
  })

  it('pickDueNotes 只挑到期的那几张', () => {
    const a = note({ id: 'a', schedule: schedule({ mode: 'daily', time: '09:00', nextAt: 10 }) })
    const b = note({ id: 'b', schedule: schedule({ mode: 'daily', time: '09:00', nextAt: 10_000 }) })
    const c = note({ id: 'c' })
    expect(pickDueNotes([a, b, c], 100).map((n) => n.id)).toEqual(['a'])
  })

  it('isOnceStale：一次性过期超过一周才算过期', () => {
    const s = schedule({ mode: 'once', at: 0 })
    expect(isOnceStale(s, ONCE_STALE_MS)).toBe(false)
    expect(isOnceStale(s, ONCE_STALE_MS + 1)).toBe(true)
    expect(isOnceStale(schedule({ mode: 'daily', time: '09:00' }), ONCE_STALE_MS * 10)).toBe(false)
  })
})

describe('applyScheduleDispatch', () => {
  const now = at(2026, 1, 5, 10, 0)

  it('派发成功：循环顺延下一周期，一次性停用', () => {
    const daily = applyScheduleDispatch(schedule({ mode: 'daily', time: '09:00', nextAt: at(2026, 1, 5, 9, 0) }), 'dispatched', now)
    expect(daily.enabled).toBe(true)
    expect(daily.lastFiredAt).toBe(now)
    expect(daily.nextAt).toBe(at(2026, 1, 6, 9, 0))
    const once = applyScheduleDispatch(schedule({ mode: 'once', at: at(2026, 1, 5, 9, 0) }), 'dispatched', now)
    expect(once.enabled).toBe(false)
    expect(once.lastResult).toBe('已派发')
  })

  it('循环忙：记跳过原因并顺延，不反复派发', () => {
    const next = applyScheduleDispatch(schedule({ mode: 'daily', time: '09:00', nextAt: now }), 'busy', now)
    expect(next.enabled).toBe(true)
    expect(next.lastResult).toContain('上一轮未结束')
    expect(next.nextAt).toBe(at(2026, 1, 6, 9, 0))
  })

  it('一次性忙：5 分钟后重试（不放弃）', () => {
    const next = applyScheduleDispatch(schedule({ mode: 'once', at: now }), 'busy', now)
    expect(next.enabled).toBe(true)
    expect(next.nextAt).toBe(now + SCHEDULE_RETRY_MS)
  })

  it('一次性派发失败：停用并记原因（不反复重试、不堆会话）', () => {
    const next = applyScheduleDispatch(schedule({ mode: 'once', at: now }), 'missing-workspace', now)
    expect(next.enabled).toBe(false)
    expect(next.lastResult).toContain('未配置工作区')
  })

  it('循环派发失败：记原因并顺延（下一周期再试）', () => {
    const next = applyScheduleDispatch(schedule({ mode: 'daily', time: '09:00', nextAt: now }), 'no-dispatch', now)
    expect(next.enabled).toBe(true)
    expect(next.lastResult).toContain('未装配会话控制器')
    expect(next.nextAt).toBe(at(2026, 1, 6, 9, 0))
  })
})

describe('状态闸门（待规划 / 已完成 / 已失败不自动派发）', () => {
  const due = (): NoteSchedule => schedule({ mode: 'daily', time: '09:00', nextAt: 0 })

  it('待规划 / 已完成 / 已失败各有未派发原因，待办与进行中放行', () => {
    expect(scheduleBlockReason(note({ status: 'backlog', schedule: due() }))).toBe('待规划中，未派发')
    expect(scheduleBlockReason(note({ status: 'done', schedule: due() }))).toBe('已完成，未派发')
    expect(scheduleBlockReason(note({ status: 'failed', schedule: due() }))).toBe('已失败，未派发')
    expect(scheduleBlockReason(note({ status: 'todo', schedule: due() }))).toBeUndefined()
    expect(scheduleBlockReason(note({ status: 'running', schedule: due() }))).toBeUndefined()
  })

  it('非任务 / 无日程 / 已停用日程：没有闸门（保持原有语义）', () => {
    expect(scheduleBlockReason(note({ lane: false, schedule: due() }))).toBeUndefined()
    expect(scheduleBlockReason(note({ status: 'backlog' }))).toBeUndefined()
    expect(
      scheduleBlockReason(note({ status: 'backlog', schedule: schedule({ mode: 'daily', time: '09:00', nextAt: 0, enabled: false }) })),
    ).toBeUndefined()
  })

  it('被挡住的循环日程：顺延到下一周期并记下原因（不是失败，不计熔断）', () => {
    const now = at(2026, 1, 5, 10, 0)
    const next = applyScheduleSkip(schedule({ mode: 'daily', time: '09:00', nextAt: at(2026, 1, 5, 9, 0) }), '待规划中，未派发', now)
    expect(next?.enabled).toBe(true)
    expect(next?.nextAt).toBe(at(2026, 1, 6, 9, 0))
    expect(next?.lastResult).toBe('待规划中，未派发')
    expect(next?.failureStreak).toBeUndefined()
  })

  it('被挡住的一次性日程：不写回（等用户处置；过期太久由 isOnceStale 收尾）', () => {
    expect(applyScheduleSkip(schedule({ mode: 'once', at: 0 }), '待规划中，未派发', 1000)).toBeUndefined()
  })

  it('UI 复用同一份判定/文案（编辑器与卡片不必各写一份）', () => {
    expect(isScheduleBlockedStatus('backlog')).toBe(true)
    expect(isScheduleBlockedStatus('done')).toBe(true)
    expect(isScheduleBlockedStatus('failed')).toBe(true)
    expect(isScheduleBlockedStatus('todo')).toBe(false)
    expect(isScheduleBlockedStatus('running')).toBe(false)
    expect(isScheduleBlockedStatus(undefined)).toBe(false)
    expect(scheduleBlockTextFor('backlog')).toBe('待规划中，未派发')
    expect(scheduleBlockTextFor('todo')).toBeUndefined()
  })
})

describe('失败计数与熔断（错误边界：不让他无限制执行）', () => {
  const now = at(2026, 1, 5, 10, 0)
  const daily = (input: Partial<NoteSchedule> = {}): NoteSchedule =>
    schedule({ mode: 'daily', time: '09:00', nextAt: now, ...input })

  it('派发成功：运行次数 +1、失败连击清零', () => {
    const next = applyScheduleDispatch(daily({ runCount: 2, failureStreak: 1 }), 'dispatched', now)
    expect(next.runCount).toBe(3)
    expect(next.failureStreak).toBe(0)
    expect(next.enabled).toBe(true)
  })

  it('忙（上一轮未结束）不算失败', () => {
    const next = applyScheduleDispatch(daily({ failureStreak: 1 }), 'busy', now)
    expect(next.failureStreak).toBe(1)
    expect(next.enabled).toBe(true)
  })

  it('派发失败累加，达到上限自动停用并写明原因', () => {
    const first = applyScheduleDispatch(daily(), 'no-dispatch', now)
    expect(first.failureStreak).toBe(1)
    expect(first.enabled).toBe(true)
    const second = applyScheduleDispatch(first, 'no-dispatch', now)
    expect(second.failureStreak).toBe(2)
    expect(second.enabled).toBe(true)
    const third = applyScheduleDispatch(second, 'no-dispatch', now)
    expect(third.failureStreak).toBe(SCHEDULE_MAX_FAILURES)
    expect(third.enabled).toBe(false)
    expect(third.lastResult).toBe(`连续 ${SCHEDULE_MAX_FAILURES} 次失败，已停用`)
  })

  it('运行失败（agent 报 failed / host 超时兜底）同样累加与熔断', () => {
    const killed = applyRunResult(daily({ failureStreak: SCHEDULE_MAX_FAILURES - 1 }), false, now)
    expect(killed?.enabled).toBe(false)
    expect(killed?.lastResult).toBe(`连续 ${SCHEDULE_MAX_FAILURES} 次失败，已停用`)
    expect(applyRunResult(daily({ failureStreak: 2 }), true, now)?.failureStreak).toBe(0)
  })

  it('已停用的日程：运行结果不再改写（一次性派发后即停用）', () => {
    expect(applyRunResult(daily({ enabled: false }), false, now)).toBeUndefined()
    expect(applyRunResult(daily(), true, now)).toBeUndefined()
  })

  it('保存日程不得清掉 host 自有计数（sanitizeSchedule 原样保留）', () => {
    const armed = armSchedule(
      { enabled: true, mode: 'daily', time: '09:00', failureStreak: 2, runCount: 5, lastResult: '已派发' },
      now,
    )
    expect(armed?.failureStreak).toBe(2)
    expect(armed?.runCount).toBe(5)
    expect(armed?.lastResult).toBe('已派发')
    // 非法计数不落库（不是数字 → 丢弃，不写脏值）。
    expect(armSchedule({ enabled: true, mode: 'daily', time: '09:00', failureStreak: Number.NaN }, now)?.failureStreak).toBeUndefined()
  })
})