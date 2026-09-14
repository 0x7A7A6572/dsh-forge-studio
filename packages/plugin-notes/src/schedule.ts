/**
 * 定时执行纯语义（host 调度器与 client UI 共用）：无副作用、不触 DOM/服务，便于单测。
 *
 * 时间一律按**本机本地时区**解释（便签是个人工具，不引入时区库）。核心三件事：
 * 1. nextFireAt —— 「严格晚于 from 的下一次触发时刻」，是排程的唯一算法；
 * 2. armSchedule / sanitizeSchedule —— 保存与启用时的入参校验 + nextAt 对齐；
 * 3. applyScheduleDispatch / isNoteScheduleDue —— 派发结果 → 写回的日程、到期判定。
 *
 * 语义约定（与 types.ts 的 NoteSchedule 头注释一致）：
 * - once：触发成功后自动停用（enabled=false 但记录保留）；派发失败不反复重试（停用并
 *   记原因），唯有 busy（上一轮还没跑完）重试一次——见 ONCE / SCHEDULE_RETRY_MS；
 * - interval：锚点 = 上次排定的 nextAt，闭式推进（宿主停机再久也只跳一格，不堆补跑）；
 * - daily/weekly/monthly：日历式向后找，最多找 CALENDAR_SEARCH_DAYS 天。
 */

import { SCHEDULE_MODES } from './types.ts'
import type { NoteRecord, NoteSchedule, NoteScheduleInput, ScheduleMode, TaskStatus } from './types.ts'
import { fmtDateTime } from './client/core/time-text.ts'

/** 一次性日程因「上一轮未结束」跳过后，推迟重试的间隔。 */
export const SCHEDULE_RETRY_MS = 5 * 60 * 1000
/** 一次性日程过期超过该时长（宿主长期未运行）→ 不再补跑，直接停用。 */
export const ONCE_STALE_MS = 7 * 24 * 60 * 60 * 1000
/** 日历式循环向后搜索的天数上限（> 1 年必命中，纯防御，避免死循环）。 */
const CALENDAR_SEARCH_DAYS = 400
/**
 * 错误边界：连续失败达到该次数 → 自动停用日程。无人值守时一次配置错误（工作区没了、
 * 宿主没装配会话控制器）会让循环日程每周期空转一次、永远重试，故给一道熔断。
 */
export const SCHEDULE_MAX_FAILURES = 3
/**
 * 错误边界：定时派发出去的执行超过该时长仍未收尾（agent 没 report / 会话没了）→
 * 由宿主按失败收尾并撤销租约。没有这道兜底，一条卡住的 run 会让便签永久「进行中」
 * 且租约永久占着，后续每轮只能记「上一轮未结束」。只认领 by='schedule' 的 run。
 * 放这里的理由：它和熔断同属「定时执行」的对外语义，client 的确认弹窗要如实转述。
 */
export const SCHEDULE_RUN_TIMEOUT_MS = 30 * 60 * 1000
const MINUTE_MS = 60_000

/** 'HH:mm' 解析：非法（形状不符 / 越界 / 非整数）→ undefined。 */
export function parseTimeOfDay(value: string): { readonly hours: number; readonly minutes: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined
  return { hours, minutes }
}

/** 当天零点（本地时区）。 */
function startOfDay(ts: number): Date {
  const day = new Date(ts)
  day.setHours(0, 0, 0, 0)
  return day
}

/** 把某天的时刻置为 hours:minutes（秒/毫秒归零），返回时间戳。 */
function atTimeOfDay(day: Date, hours: number, minutes: number): number {
  const at = new Date(day)
  at.setHours(hours, minutes, 0, 0)
  return at.getTime()
}

/**
 * 计算**严格晚于 from** 的下一次触发时刻；无解（一次性已过期 / 参数非法）→ undefined。
 *
 * interval 用闭式推进：锚点取 schedule.nextAt（无有效值则取 from），
 * `start + k * step` 一步到位——宿主停机一年也只算出「下一格」，不做补跑循环。
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
 * 入参校验与归一（client 传入的日程草稿 → 可落库的形状）：
 * 语义非法（模式不认识 / 缺该模式必填参数 / 星期为空或越界 / 每 N 分钟 < 1）→ undefined，
 * 由调用方决定拒绝还是忽略。host 自有字段（nextAt/lastFiredAt/lastResult）原样保留。
 */
export function sanitizeSchedule(input: NoteScheduleInput): NoteSchedule | undefined {
  if (!(SCHEDULE_MODES as readonly string[]).includes(input.mode)) return undefined
  const mode = input.mode as ScheduleMode
  const enabled = input.enabled === true
  const nextAt = Number.isFinite(input.nextAt) ? (input.nextAt as number) : 0
  const lastFiredAt = Number.isFinite(input.lastFiredAt) ? (input.lastFiredAt as number) : undefined
  const lastResult = typeof input.lastResult === 'string' ? input.lastResult : undefined
  // host 自有的错误边界计数同样原样保留：丢了它，用户一保存日程就把熔断/运行次数清零。
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
 * 保存/启用时对齐 nextAt：按 from **之后**重算（interval 从 from 起算新节奏，once 用 at
 * 本身）。语义非法 → undefined（调用方拒绝该次写入，不静默清掉既有日程）。
 */
export function armSchedule(input: NoteScheduleInput, from: number): NoteSchedule | undefined {
  const base = sanitizeSchedule(input)
  if (base === undefined) return undefined
  if (!base.enabled) return base
  if (base.mode === 'once') return { ...base, nextAt: base.at as number }
  // interval 的锚点故意换成 from：保存即「从现在起算」，不吃入参里可能过期的 nextAt。
  const next = nextFireAt({ ...base, nextAt: from }, from)
  return next === undefined ? undefined : { ...base, nextAt: next }
}

/** 可写字段签名（忽略 host 自有的 nextAt/lastFiredAt/lastResult）：用于「日程是否改过」。 */
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

/** 日期时间输入控件的本地值：'YYYY-MM-DDTHH:mm'（<input type="datetime-local"> 用）。 */
export function toLocalDateTimeInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 日期时间输入控件值 → 时间戳；非法/空 → undefined。 */
export function fromLocalDateTimeInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const ts = new Date(trimmed).getTime()
  return Number.isFinite(ts) ? ts : undefined
}

/**
 * 编辑器里「切到某模式」时的默认值（保留上一份草稿能复用的字段）：
 * 默认启用、时间 09:00、间隔 30 分钟、每周一、每月 1 日、一次性 = 一小时后。
 */
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

/** 编辑器只读展示用的「下次触发」预览：已有权威 nextAt 就用它，否则按当前时刻试算。 */
export function previewNextAt(schedule: NoteScheduleInput, now: number = Date.now()): number | undefined {
  if (!schedule.enabled) return undefined
  if (schedule.nextAt !== undefined && Number.isFinite(schedule.nextAt) && schedule.nextAt > 0) return schedule.nextAt
  return nextFireAt({ ...schedule, nextAt: 0 } as NoteSchedule, now)
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 日程中文摘要（卡片徽标 / 编辑器标题 / 日志）：'每天 09:00'、'每 30 分钟' 等。 */
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

/**
 * 状态闸门文案：这些泳道状态的任务即使到点也不自动派发。
 * 待规划 = 还没定下来要做；已完成 / 已失败 = 这一轮已经结束，系统不该擅自再跑起来。
 */
const STATUS_BLOCK_TEXT: Partial<Record<TaskStatus, string>> = {
  backlog: '待规划中，未派发',
  done: '已完成，未派发',
  failed: '已失败，未派发',
}

/**
 * 状态闸门：该泳道状态是否不自动派发（待规划 / 已完成 / 已失败）。
 * UI 复用同一份判定（编辑器/卡片提示「当前状态不会自动执行」），避免两处各写一份。
 */
export function isScheduleBlockedStatus(status: TaskStatus | undefined): boolean {
  return status !== undefined && STATUS_BLOCK_TEXT[status] !== undefined
}

/**
 * 状态闸门：该便签此刻是否因泳道状态而不该自动派发（待规划 / 已完成 / 已失败）。
 *
 * 这是**软闸门**：不动 enabled、不改 nextAt、不删日程配置——把卡片拖回「待办」即自动
 * 恢复，用户手动摆的状态不会被系统覆盖（对比：归档 / 取消任务仍是硬闸门，日程直接失效）。
 * @returns 未派发的中文原因；不该挡时 undefined。
 */
export function scheduleBlockReason(note: NoteRecord): string | undefined {
  const schedule = note.schedule
  if (schedule === undefined || !schedule.enabled) return undefined
  const status = note.lane?.status
  if (status === undefined) return undefined
  return STATUS_BLOCK_TEXT[status]
}

/** 编辑器用：给定状态下的未派发原因（无则 undefined），与 scheduleBlockReason 同源。 */
export function scheduleBlockTextFor(status: TaskStatus | undefined): string | undefined {
  return status === undefined ? undefined : STATUS_BLOCK_TEXT[status]
}

/** 该便签此刻是否到期该派发：启用 + 未归档 + 是任务 + nextAt 已到。 */
export function isNoteScheduleDue(note: NoteRecord, now: number): boolean {
  const schedule = note.schedule
  if (schedule === undefined || !schedule.enabled || note.archived || note.lane === undefined) return false
  return Number.isFinite(schedule.nextAt) && schedule.nextAt <= now
}

/** 到期便签筛选（调度器 tick 的纯函数部分）。 */
export function pickDueNotes(notes: readonly NoteRecord[], now: number): readonly NoteRecord[] {
  return notes.filter((note) => isNoteScheduleDue(note, now))
}

/** 派发结果（与 NotesService.taskExecute 的失败 reason 对齐，'missing' 由调用方另行处理）。 */
export type ScheduleDispatchOutcome = 'dispatched' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed'

const OUTCOME_TEXT: Record<ScheduleDispatchOutcome, string> = {
  dispatched: '已派发',
  busy: '上一轮未结束，本轮跳过',
  'missing-workspace': '未配置工作区，未派发',
  'no-dispatch': '宿主未装配会话控制器，未派发',
  'dispatch-failed': '派发失败',
}

/** 一次性日程已过期太久（宿主长期未运行）→ 不再补跑。 */
export function isOnceStale(schedule: NoteSchedule, now: number): boolean {
  return schedule.mode === 'once' && schedule.at !== undefined && now - schedule.at > ONCE_STALE_MS
}

/** 失败连击进位；达到上限 → 自动停用并写明原因（错误边界）。 */
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
 * 被状态闸门挡住的到期日程 → 写回：顺延到下一周期并记下原因。
 * 不算失败（不动 failureStreak），因此不会触发熔断——待规划放一周也不会把日程烧停。
 *
 * 一次性日程返回 undefined：它的 nextAt = at 是绝对时刻，不写回就不会重建时间轴——
 * 用户拖回「待办」时若还没过期就补跑一次，过期太久由 isOnceStale 停用。
 */
export function applyScheduleSkip(schedule: NoteSchedule, text: string, now: number): NoteSchedule | undefined {
  if (schedule.mode === 'once') return undefined
  return { ...schedule, lastResult: text, nextAt: nextFireAt(schedule, now) ?? schedule.nextAt }
}

/**
 * 运行收尾写回（agent 报 done/failed，或 host 超时兜底）：
 * - 成功 → failureStreak 清零（本来就无值则不写回，返回 undefined）；
 * - 失败 → 累加，达到上限自动停用（错误边界）。
 * 已停用的日程一律返回 undefined：一次性日程派发成功即停用，其运行结果不再改写日程。
 */
export function applyRunResult(schedule: NoteSchedule, ok: boolean, _now: number): NoteSchedule | undefined {
  if (!schedule.enabled) return undefined
  if (ok) return schedule.failureStreak === undefined ? undefined : { ...schedule, failureStreak: 0 }
  return bumpFailure(schedule)
}

/**
 * 派发结果 → 写回的新日程：
 * - 成功：记 lastFiredAt/lastResult；循环顺延下一次（nextAt 从 now 之后重算，不补历史），
 *   一次性停用（记录保留，UI 显示「已执行」）；
 * - busy（上一轮未结束）：循环顺延下一周期；一次性 5 分钟后重试（未过期时）；
 * - 其它失败：循环记原因后顺延（不刷屏）；一次性直接停用（不反复重试、不堆执行会话）。
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
      // 错误边界计数：成功一次 → 运行次数 +1、失败连击清零。
      runCount: (schedule.runCount ?? 0) + 1,
      failureStreak: 0,
      nextAt: recurring ? nextFireAt(schedule, now) ?? schedule.nextAt : schedule.nextAt,
    }
  }
  if (outcome === 'busy') {
    // 忙 = 上一轮还没结束，是正常状态不是失败：不计连击。
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
    // 派发失败（工作区没配 / 宿主没装配会话控制器 / 建会话抛错）：仍顺延重试，
    // 但连续失败到上限即停用——不让他无限制空转。
    return bumpFailure({
      ...schedule,
      lastResult: text,
      nextAt: nextFireAt(schedule, now) ?? schedule.nextAt,
    })
  }
  return { ...schedule, enabled: false, lastResult: `${text}，已停用` }
}
