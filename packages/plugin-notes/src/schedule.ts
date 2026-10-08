/**
 * 定时执行纯语义（host 调度器与 client UI 共用，无副作用）；时间按本机本地时区解释。
 * once 触发后自动停用；interval 锚点取上次排定的 nextAt，闭式推进不堆补跑。
 */

import { SCHEDULE_MODES } from './types.ts'
import type { NoteRecord, NoteSchedule, NoteScheduleInput, ScheduleMode, TaskStatus } from './types.ts'
import { fmtDateTime } from './client/core/time-text.ts'

export const SCHEDULE_RETRY_MS = 5 * 60 * 1000
/** 一次性日程过期超过该时长 → 不再补跑，直接停用。 */
export const ONCE_STALE_MS = 7 * 24 * 60 * 60 * 1000
/** 日历式循环向后搜索的天数上限；> 1 年必命中。 */
const CALENDAR_SEARCH_DAYS = 400
/** 连续失败达到该次数 → 自动停用日程。 */
export const SCHEDULE_MAX_FAILURES = 3
/**
 * 定时 run 超过该时长仍未收尾 → 宿主按失败收尾并撤销租约；
 * 只认领 by='schedule' 的 run。
 */
export const SCHEDULE_RUN_TIMEOUT_MS = 30 * 60 * 1000
const MINUTE_MS = 60_000

export function parseTimeOfDay(value: string): { readonly hours: number; readonly minutes: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined
  return { hours, minutes }
}

function startOfDay(ts: number): Date {
  const day = new Date(ts)
  day.setHours(0, 0, 0, 0)
  return day
}

function atTimeOfDay(day: Date, hours: number, minutes: number): number {
  const at = new Date(day)
  at.setHours(hours, minutes, 0, 0)
  return at.getTime()
}

/**
 * 严格晚于 from 的下一次触发时刻；无解（once 已过期 / 参数非法）→ undefined。
 * interval 用闭式推进（锚点取 schedule.nextAt），停机再久也只算出下一格。
 */
export function nextFireAt(schedule: NoteSchedule, from: number): number | undefined {
  switch (schedule.mode) {
    case 'once': {
      const at = schedule.at
      return at !== undefined && Number.isFinite(at) && at > from ? at : undefined
    }
    case 'interval': {
      const everyMin = schedule.everyMin
      if (everyMin === undefined || !Number.isFinite(everyMin) || everyMin < 1) return undefined
      const step = Math.round(everyMin) * MINUTE_MS
      const anchor = Number.isFinite(schedule.nextAt) && schedule.nextAt > 0 ? schedule.nextAt : from
      if (anchor > from) return anchor
      const k = Math.floor((from - anchor) / step) + 1
      return anchor + k * step
    }
    case 'daily':
    case 'weekly':
    case 'monthly': {
      const parsed = parseTimeOfDay(schedule.time ?? '')
      if (parsed === undefined) return undefined
      const weekdays = schedule.weekdays ?? []
      const monthDay = schedule.monthDay
      if (schedule.mode === 'weekly' && weekdays.length === 0) return undefined
      if (schedule.mode === 'monthly' && (monthDay === undefined || !Number.isFinite(monthDay))) return undefined
      const day = startOfDay(from)
      for (let i = 0; i < CALENDAR_SEARCH_DAYS; i += 1) {
        const cursor = new Date(day)
        cursor.setDate(cursor.getDate() + i)
        if (schedule.mode === 'weekly' && !weekdays.includes(cursor.getDay())) continue
        if (schedule.mode === 'monthly') {
          // 当月不足该日（如 2 月 30 日）时落在当月最后一天。
          const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
          if (cursor.getDate() !== Math.min(Math.round(monthDay!), lastDay)) continue
        }
        const candidate = atTimeOfDay(cursor, parsed.hours, parsed.minutes)
        if (candidate > from) return candidate
      }
      return undefined
    }
    default:
      return undefined
  }
}

/**
 * 入参校验与归一（client 草稿 → 可落库形状）；语义非法 → undefined，
 * 由调用方决定拒绝还是忽略。host 自有字段（nextAt / lastFiredAt / lastResult /
 * failureStreak / runCount）一律原样保留。
 */
export function sanitizeSchedule(input: NoteScheduleInput): NoteSchedule | undefined {
  if (!(SCHEDULE_MODES as readonly string[]).includes(input.mode)) return undefined
  const mode = input.mode as ScheduleMode
  const enabled = input.enabled === true
  const nextAt = Number.isFinite(input.nextAt) ? (input.nextAt as number) : 0
  const lastFiredAt = Number.isFinite(input.lastFiredAt) ? (input.lastFiredAt as number) : undefined
  const lastResult = typeof input.lastResult === 'string' ? input.lastResult : undefined
  const failureStreak = Number.isFinite(input.failureStreak) ? (input.failureStreak as number) : undefined
  const runCount = Number.isFinite(input.runCount) ? (input.runCount as number) : undefined
  const base = {
    enabled,
    mode,
    nextAt,
    ...(lastFiredAt !== undefined ? { lastFiredAt } : {}),
    ...(lastResult !== undefined ? { lastResult } : {}),
    ...(failureStreak !== undefined ? { failureStreak } : {}),
    ...(runCount !== undefined ? { runCount } : {}),
  }
  switch (mode) {
    case 'once': {
      const at = input.at
      if (at === undefined || !Number.isFinite(at)) return undefined
      return { ...base, at }
    }
    case 'interval': {
      const everyMin = input.everyMin
      if (everyMin === undefined || !Number.isFinite(everyMin) || everyMin < 1) return undefined
      return { ...base, everyMin: Math.round(everyMin) }
    }
    case 'daily': {
      if (parseTimeOfDay(input.time ?? '') === undefined) return undefined
      return { ...base, time: input.time }
    }
    case 'weekly': {
      if (parseTimeOfDay(input.time ?? '') === undefined) return undefined
      const weekdays = (input.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      if (weekdays.length === 0) return undefined
      return { ...base, time: input.time, weekdays: [...new Set(weekdays)].sort((a, b) => a - b) }
    }
    case 'monthly': {
      if (parseTimeOfDay(input.time ?? '') === undefined) return undefined
      const monthDay = input.monthDay
      if (monthDay === undefined || !Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) return undefined
      return { ...base, time: input.time, monthDay }
    }
    default:
      return undefined
  }
}

/**
 * 保存/启用时按 from 之后对齐 nextAt（interval 从 from 起算，once 用 at）。
 * 语义非法 → undefined，调用方拒绝该次写入。
 */
export function armSchedule(input: NoteScheduleInput, from: number): NoteSchedule | undefined {
  const base = sanitizeSchedule(input)
  if (base === undefined) return undefined
  if (!base.enabled) return base
  if (base.mode === 'once') return { ...base, nextAt: base.at as number }
  const next = nextFireAt({ ...base, nextAt: from }, from)
  return next === undefined ? undefined : { ...base, nextAt: next }
}

export function scheduleSignature(schedule: NoteScheduleInput | NoteSchedule | undefined): string {
  if (schedule === undefined) return ''
  return JSON.stringify([
    schedule.enabled,
    schedule.mode,
    schedule.at ?? null,
    schedule.everyMin ?? null,
    schedule.time ?? null,
    schedule.weekdays ?? null,
    schedule.monthDay ?? null,
  ])
}

/** datetime-local 控件值格式：'YYYY-MM-DDTHH:mm'。 */
export function toLocalDateTimeInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalDateTimeInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const ts = new Date(trimmed).getTime()
  return Number.isFinite(ts) ? ts : undefined
}

/** 切模式的默认值：启用、09:00、30 分钟、周一、每月 1 日、一次性一小时后。 */
export function makeSchedule(
  mode: ScheduleMode,
  previous?: NoteScheduleInput,
  now: number = Date.now(),
): NoteScheduleInput {
  const enabled = true
  const time = parseTimeOfDay(previous?.time ?? '') !== undefined ? previous!.time : '09:00'
  switch (mode) {
    case 'once': {
      const at = previous?.at !== undefined && previous.at > now ? previous.at : now + 60 * MINUTE_MS
      return { enabled, mode, at }
    }
    case 'interval':
      return { enabled, mode, everyMin: previous?.everyMin !== undefined && previous.everyMin >= 1 ? previous.everyMin : 30 }
    case 'daily':
      return { enabled, mode, time }
    case 'weekly':
      return {
        enabled,
        mode,
        time,
        weekdays: previous?.weekdays !== undefined && previous.weekdays.length > 0 ? previous.weekdays : [1],
      }
    case 'monthly':
      return {
        enabled,
        mode,
        time,
        monthDay: previous?.monthDay !== undefined && previous.monthDay >= 1 ? previous.monthDay : 1,
      }
    default:
      return { enabled, mode: 'daily', time }
  }
}

/** 已有权威 nextAt 就用它，否则按 now 试算。 */
export function previewNextAt(schedule: NoteScheduleInput, now: number = Date.now()): number | undefined {
  if (!schedule.enabled) return undefined
  if (schedule.nextAt !== undefined && Number.isFinite(schedule.nextAt) && schedule.nextAt > 0) return schedule.nextAt
  return nextFireAt({ ...schedule, nextAt: 0 } as NoteSchedule, now)
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function scheduleLabel(schedule: NoteSchedule | NoteScheduleInput | undefined): string {
  if (schedule === undefined) return ''
  switch (schedule.mode) {
    case 'once':
      return schedule.at !== undefined ? `一次性 ${fmtDateTime(schedule.at)}` : '一次性'
    case 'interval':
      return schedule.everyMin !== undefined
        ? schedule.everyMin % 60 === 0
          ? `每 ${schedule.everyMin / 60} 小时`
          : `每 ${schedule.everyMin} 分钟`
        : '按间隔'
    case 'daily':
      return `每天 ${schedule.time ?? ''}`.trim()
    case 'weekly': {
      const days = (schedule.weekdays ?? [])
        .map((day) => WEEKDAY_LABELS[day] as string | undefined)
        .filter((label): label is string => label !== undefined)
      return `每${days.join('、')} ${schedule.time ?? ''}`.trim()
    }
    case 'monthly':
      return `每月 ${schedule.monthDay ?? ''} 日 ${schedule.time ?? ''}`.trim()
    default:
      return '定时'
  }
}

/** 这些泳道状态即使到点也不自动派发。 */
const STATUS_BLOCK_TEXT: Partial<Record<TaskStatus, string>> = {
  backlog: '待规划中，未派发',
  done: '已完成，未派发',
  failed: '已失败，未派发',
}

export function isScheduleBlockedStatus(status: TaskStatus | undefined): boolean {
  return status !== undefined && STATUS_BLOCK_TEXT[status] !== undefined
}

/**
 * 软闸门：只给出未派发原因，不动 enabled / nextAt / 日程配置，
 * 把卡片拖回「待办」即自动恢复。
 * @returns 未派发的中文原因；不该挡时 undefined。
 */
export function scheduleBlockReason(note: NoteRecord): string | undefined {
  const schedule = note.schedule
  if (schedule === undefined || !schedule.enabled) return undefined
  const status = note.lane?.status
  if (status === undefined) return undefined
  return STATUS_BLOCK_TEXT[status]
}

export function scheduleBlockTextFor(status: TaskStatus | undefined): string | undefined {
  return status === undefined ? undefined : STATUS_BLOCK_TEXT[status]
}

export function isNoteScheduleDue(note: NoteRecord, now: number): boolean {
  const schedule = note.schedule
  if (schedule === undefined || !schedule.enabled || note.archived || note.lane === undefined) return false
  return Number.isFinite(schedule.nextAt) && schedule.nextAt <= now
}

export function pickDueNotes(notes: readonly NoteRecord[], now: number): readonly NoteRecord[] {
  return notes.filter((note) => isNoteScheduleDue(note, now))
}

/** 与 NotesService.taskExecute 的失败 reason 对齐；'missing' 由调用方另行处理。 */
export type ScheduleDispatchOutcome = 'dispatched' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed'

const OUTCOME_TEXT: Record<ScheduleDispatchOutcome, string> = {
  dispatched: '已派发',
  busy: '上一轮未结束，本轮跳过',
  'missing-workspace': '未配置工作区，未派发',
  'no-dispatch': '宿主未装配会话控制器，未派发',
  'dispatch-failed': '派发失败',
}

export function isOnceStale(schedule: NoteSchedule, now: number): boolean {
  return schedule.mode === 'once' && schedule.at !== undefined && now - schedule.at > ONCE_STALE_MS
}

function bumpFailure(schedule: NoteSchedule): NoteSchedule {
  const failureStreak = (schedule.failureStreak ?? 0) + 1
  if (failureStreak >= SCHEDULE_MAX_FAILURES) {
    return {
      ...schedule,
      failureStreak,
      enabled: false,
      lastResult: `连续 ${SCHEDULE_MAX_FAILURES} 次失败，已停用`,
    }
  }
  return { ...schedule, failureStreak }
}

/**
 * 被状态闸门挡住的到期日程 → 顺延到下一周期并记原因；不计 failureStreak。
 * once 返回 undefined：nextAt 是绝对时刻，不写回以免重建时间轴。
 */
export function applyScheduleSkip(schedule: NoteSchedule, text: string, now: number): NoteSchedule | undefined {
  if (schedule.mode === 'once') return undefined
  return { ...schedule, lastResult: text, nextAt: nextFireAt(schedule, now) ?? schedule.nextAt }
}

/**
 * 运行收尾写回：成功清零 failureStreak（本来就无值 → undefined）；
 * 失败累加、达上限即停用；已停用的日程一律 undefined。
 */
export function applyRunResult(schedule: NoteSchedule, ok: boolean, _now: number): NoteSchedule | undefined {
  if (!schedule.enabled) return undefined
  if (ok) return schedule.failureStreak === undefined ? undefined : { ...schedule, failureStreak: 0 }
  return bumpFailure(schedule)
}

/**
 * 派发结果 → 写回的新日程：dispatched 记 lastFiredAt/lastResult 并顺延（once 停用）；
 * busy 循环顺延、once 5 分钟后重试；其它失败循环记原因后顺延，once 直接停用。
 */
export function applyScheduleDispatch(
  schedule: NoteSchedule,
  outcome: ScheduleDispatchOutcome,
  now: number,
): NoteSchedule {
  const recurring = schedule.mode !== 'once'
  const text = OUTCOME_TEXT[outcome]
  if (outcome === 'dispatched') {
    return {
      ...schedule,
      enabled: recurring,
      lastFiredAt: now,
      lastResult: text,
      runCount: (schedule.runCount ?? 0) + 1,
      failureStreak: 0,
      nextAt: recurring ? nextFireAt(schedule, now) ?? schedule.nextAt : schedule.nextAt,
    }
  }
  if (outcome === 'busy') {
    const at = schedule.at
    if (recurring) {
      return { ...schedule, lastResult: text, nextAt: nextFireAt(schedule, now) ?? schedule.nextAt }
    }
    if (at !== undefined && !isOnceStale(schedule, now)) {
      return { ...schedule, nextAt: now + SCHEDULE_RETRY_MS, lastResult: `${text}，5 分钟后重试` }
    }
    return { ...schedule, enabled: false, lastResult: `${text}，已停用` }
  }
  if (recurring) {
    return bumpFailure({
      ...schedule,
      lastResult: text,
      nextAt: nextFireAt(schedule, now) ?? schedule.nextAt,
    })
  }
  return { ...schedule, enabled: false, lastResult: `${text}，已停用` }
}
