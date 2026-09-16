import { describe, expect, it } from 'vitest'
import { addDays, dayKey, daysInRange, rangeToSpec, startOfDayMs } from '../src/time.ts'

const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min).getTime()

describe('time', () => {
  it('按本机时区归天（跨日边界）', () => {
    expect(dayKey(d(2026, 9, 16, 23, 59))).toBe('2026-09-16')
    expect(dayKey(d(2026, 9, 17, 0, 1))).toBe('2026-09-17')
  })

  it('startOfDayMs 落在当天零点', () => {
    expect(dayKey(startOfDayMs(d(2026, 9, 16, 13, 45)))).toBe('2026-09-16')
    expect(startOfDayMs(d(2026, 9, 16, 13, 45))).toBeLessThanOrEqual(d(2026, 9, 16, 13, 45))
  })

  it('addDays 用日历加法（不受 DST 影响）', () => {
    expect(dayKey(addDays(d(2026, 3, 7), 1))).toBe('2026-03-08')
    expect(dayKey(addDays(d(2026, 11, 1), -1))).toBe('2026-10-31')
  })

  it('7d 覆盖含今天在内的 7 天', () => {
    const now = d(2026, 9, 16, 15)
    const spec = rangeToSpec('7d', now)
    expect(dayKey(spec.since!)).toBe('2026-09-10')
    expect(dayKey(spec.until!)).toBe('2026-09-16')
  })

  it('month 从本月 1 号开始', () => {
    const spec = rangeToSpec('month', d(2026, 9, 16, 15))
    expect(dayKey(spec.since!)).toBe('2026-09-01')
  })

  it('all 不限起点，until 为 now', () => {
    const spec = rangeToSpec('all', d(2026, 9, 16, 15))
    expect(spec.since).toBeNull()
  })

  it('daysInRange 补零到连续日期', () => {
    const now = d(2026, 9, 16, 15)
    const days = daysInRange(rangeToSpec('7d', now), now)
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-09-10')
    expect(days[6]).toBe('2026-09-16')
  })

  it('all 范围用 90 天封顶，避免视图无限长', () => {
    const now = d(2026, 9, 16, 15)
    expect(daysInRange(rangeToSpec('all', now), now)).toHaveLength(90)
  })
})
