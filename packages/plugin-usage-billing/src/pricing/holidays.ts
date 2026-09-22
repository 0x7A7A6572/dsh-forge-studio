/**
 * 中国法定节假日查询（tyme4ts）。
 *
 * 库数据按年内嵌、随版本发布：查不到「这一年」时返回 unknown-year，由调用方
 * 按高峰算并出声 —— 绝不把「没数据」当成「不是节假日」。
 */
import { SolarDay } from 'tyme4ts'

export type HolidayState = 'holiday' | 'normal' | 'unknown-year'

const CN_OFFSET_MS = 8 * 3_600_000

/** 北京时间的年月日。 */
function beijingDay(timeMs: number): { year: number; month: number; day: number } {
  const d = new Date(timeMs + CN_OFFSET_MS)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

const covered = new Map<number, boolean>()

/** 该年有没有节假日数据：元旦必为法定节假日，查它即可（库缺年时返回 null）。 */
export function hasHolidayData(year: number): boolean {
  const hit = covered.get(year)
  if (hit !== undefined) return hit
  const known = SolarDay.fromYmd(year, 1, 1).getLegalHoliday() !== null
  covered.set(year, known)
  return known
}

const byDay = new Map<string, HolidayState>()

export function holidayStateAt(timeMs: number): HolidayState {
  const { year, month, day } = beijingDay(timeMs)
  const key = year + '-' + month + '-' + day
  const hit = byDay.get(key)
  if (hit !== undefined) return hit
  let state: HolidayState
  if (!hasHolidayData(year)) {
    state = 'unknown-year'
  } else {
    const holiday = SolarDay.fromYmd(year, month, day).getLegalHoliday()
    // isWork() 为真的是调休上班日，不是节假日。
    state = holiday !== null && !holiday.isWork() ? 'holiday' : 'normal'
  }
  byDay.set(key, state)
  return state
}

/** 该时刻所在的北京年份有没有节假日数据（没有就该提示用户）。 */
export function holidayDataCovers(timeMs: number): boolean {
  return hasHolidayData(beijingDay(timeMs).year)
}

/** 有数据的最后一年（数据按年连续，从当前北京年份往后探）。 */
export function lastHolidayDataYear(timeMs: number, span = 4): number {
  const start = beijingDay(timeMs).year
  let last = start - 1
  for (let year = start; year <= start + span; year++) {
    if (!hasHolidayData(year)) break
    last = year
  }
  return last
}

export function isCnHoliday(timeMs: number): boolean {
  return holidayStateAt(timeMs) === 'holiday'
}
