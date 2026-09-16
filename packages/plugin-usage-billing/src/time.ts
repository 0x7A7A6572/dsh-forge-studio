/** 本机时区的时间归天与范围窗口（纯函数）。 */

import type { RangeSpec } from './types.ts'

export type RangeKind = '7d' | '30d' | 'month' | 'all'

/** 'all' 窗口（未显式给出 since）的最大天数（视图不无限长）。 */
export const MAX_ALL_DAYS = 90

/** 显式给出 since 的窗口的硬上限（防御性；'all' 窗口由 MAX_ALL_DAYS 约束）。 */
export const MAX_RANGE_DAYS = 456

/** 本机时区下的 'YYYY-MM-DD'。 */
export function dayKey(time: number): string {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 本机时区当天零点毫秒。 */
export function startOfDayMs(time: number): number {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 日历加法（用 setDate 而非 +86400000，避免 DST 日偏移）。 */
export function addDays(time: number, n: number): number {
  const d = new Date(time)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/** 把范围种类展开成闭区间 [since, until]；'all' 的 since 为 null。 */
export function rangeToSpec(kind: RangeKind, now: number): RangeSpec {
  const until = now
  switch (kind) {
    case '7d': return { since: addDays(startOfDayMs(now), -6), until }
    case '30d': return { since: addDays(startOfDayMs(now), -29), until }
    case 'month': {
      const d = new Date(now)
      d.setDate(1)
      return { since: startOfDayMs(d.getTime()), until }
    }
    case 'all': return { since: null, until }
  }
}

/** 范围内连续日期序列（升序，含首尾，缺口由调用方补零）。 */
export function daysInRange(spec: RangeSpec, now: number): string[] {
  const until = startOfDayMs(spec.until ?? now)
  const since = spec.since === null
    ? addDays(until, -(MAX_ALL_DAYS - 1))
    : startOfDayMs(spec.since)
  const out: string[] = []
  // 循环在硬上限处停止，防止调用方传入过宽的 since 撑爆视图。
  for (let t = since; t <= until && out.length < MAX_RANGE_DAYS; t = addDays(t, 1)) {
    out.push(dayKey(t))
  }
  return out
}
