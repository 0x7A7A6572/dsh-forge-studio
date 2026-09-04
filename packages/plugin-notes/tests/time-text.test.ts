/**
 * time-text 纯函数单测：相对时间与完整时间格式。
 */

import { describe, expect, it } from 'vitest'
import { fmtDateTime, fmtElapsed, fmtRelative } from '../src/client/core/time-text.ts'

describe('fmtRelative', () => {
  const now = new Date('2025-06-01T12:00:00').getTime()

  it('60 秒内显示刚刚', () => {
    expect(fmtRelative(now - 30_000, now)).toBe('刚刚')
    expect(fmtRelative(now + 5_000, now)).toBe('刚刚') // 未来时间戳不抛错
  })

  it('分钟与小时', () => {
    expect(fmtRelative(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(fmtRelative(now - 60 * 60_000, now)).toBe('1 小时前')
  })

  it('昨天与 N 天前', () => {
    expect(fmtRelative(now - 24 * 60 * 60_000, now)).toBe('昨天')
    expect(fmtRelative(now - 3 * 24 * 60 * 60_000, now)).toBe('3 天前')
  })

  it('超过 7 天回退到具体日期', () => {
    expect(fmtRelative(now - 10 * 24 * 60 * 60_000, now)).toBe('2025-05-22')
  })
})

describe('fmtDateTime', () => {
  it('补零的完整日期时间', () => {
    expect(fmtDateTime(new Date('2025-01-02T03:04:00').getTime())).toBe('2025-01-02 03:04')
  })
})

describe('fmtElapsed', () => {
  it('秒 / 分钟 / 小时（含分钟余数）', () => {
    expect(fmtElapsed(0)).toBe('0 秒')
    expect(fmtElapsed(45_000)).toBe('45 秒')
    expect(fmtElapsed(5 * 60_000)).toBe('5 分钟')
    expect(fmtElapsed(60 * 60_000)).toBe('1 小时')
    expect(fmtElapsed(90 * 60_000)).toBe('1 小时 30 分钟')
  })

  it('负值按 0 处理（不抛错）', () => {
    expect(fmtElapsed(-5_000)).toBe('0 秒')
  })
})
