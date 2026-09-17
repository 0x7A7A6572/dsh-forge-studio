/**
 * Token 统计的纯函数测试。
 *
 * 概览页的四张卡全靠这几个函数切数：累计 / 今日 / 活跃度窗口。日期算术踩过一次坑
 * （本地时区 + 夏令时会把「加一天」算成 23 小时），所以跨月、跨年、闰年都钉住。
 */

import { describe, expect, it } from 'vitest'
import {
  HEAT_WINDOWS, HEAT_WINDOW_LABEL, activeDays, addDays, cacheHitRate, longestStreak,
  sumDays, totalTokens, windowDays, windowStart,
} from '../src/client/core/token-stats.ts'
import type { DailyPoint } from '../src/view.ts'

const day = (d: string, over: Partial<DailyPoint> = {}): DailyPoint => ({
  day: d, costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, ...over,
})

describe('totalTokens / sumDays', () => {
  it('总 Token = 未命中输入 + 缓存读 + 缓存写 + 输出', () => {
    expect(totalTokens({ input: 10, cacheRead: 20, cacheWrite: 3, output: 5 })).toBe(38)
  })

  it('合计把各列分别相加（不是只加总数）', () => {
    const total = sumDays([
      day('2026-09-01', { input: 10, cacheRead: 1, cacheWrite: 2, output: 3, calls: 1, costCny: 1.5 }),
      day('2026-09-02', { input: 5, cacheRead: 2, cacheWrite: 0, output: 7, calls: 2, costCny: 0.5 }),
    ])
    expect(total).toEqual({ input: 15, cacheRead: 3, cacheWrite: 2, output: 10, calls: 3, costCny: 2 })
    expect(totalTokens(total)).toBe(30)
  })

  it('空数组是零值（不是 NaN）', () => {
    expect(sumDays([])).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, costCny: 0 })
  })
})

describe('cacheHitRate', () => {
  it('命中率 = 缓存读 /（未命中输入 + 缓存读）', () => {
    expect(cacheHitRate({ input: 25, cacheRead: 75 })).toBeCloseTo(0.75)
  })

  it('分母不含 cacheWrite，空分母返回 0 而不是 NaN', () => {
    expect(cacheHitRate({ input: 0, cacheRead: 0 })).toBe(0)
  })
})

describe('日期算术（UTC，跨月跨年不受时区影响）', () => {
  it('加减天数', () => {
    expect(addDays('2026-09-16', 1)).toBe('2026-09-17')
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('闰年 2 月', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('解析不了就原样返回：宁可显示原值，也不伪造一个「今天」', () => {
    expect(addDays('not-a-day', 1)).toBe('not-a-day')
  })

  it('窗口起点 = 结束日往前 weeks*7-1 天（含首尾正好整数周）', () => {
    // 21 周 → 往前 146 天。
    expect(windowStart('2026-09-16', 21)).toBe(addDays('2026-09-16', -146))
  })
})

describe('windowDays（补成连续日序列）', () => {
  const sparse = [
    day('2026-09-14', { calls: 1, costCny: 2, input: 1 }),
    day('2026-09-16', { calls: 1, costCny: 3, input: 1 }),
  ]

  it('缺的那天补零，长度恒等于窗口天数', () => {
    const win = windowDays(sparse, '2026-09-14', '2026-09-16')
    expect(win.map((d) => d.day)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])
    expect(win[1]).toEqual(day('2026-09-15'))
    expect(win.reduce((a, d) => a + d.costCny, 0)).toBe(5)
  })

  it('起点晚于终点 / 非法日期 → 空（不抛，也不生成反向序列）', () => {
    expect(windowDays(sparse, '2026-09-16', '2026-09-14')).toEqual([])
    expect(windowDays(sparse, 'bad', '2026-09-16')).toEqual([])
  })

  it('超长窗口直接放弃：异常入参不该把主线程卡住', () => {
    expect(windowDays([], '2000-01-01', '2026-01-01')).toEqual([])
  })
})

describe('活跃度统计', () => {
  const days = [
    day('2026-09-01', { calls: 2 }),
    day('2026-09-02', { calls: 1 }),
    day('2026-09-03'),
    day('2026-09-04', { calls: 5 }),
  ]

  it('活跃天数只数有用量的天', () => {
    expect(activeDays(days)).toBe(3)
  })

  it('最长连续遇到断档重新计数', () => {
    expect(longestStreak(days)).toBe(2)
    expect(longestStreak([])).toBe(0)
    expect(longestStreak([day('2026-09-01', { calls: 0, input: 3 })])).toBe(1)
  })

  it('窗口选项与文案一一对应', () => {
    expect([...HEAT_WINDOWS]).toEqual([12, 21, 52])
    for (const w of HEAT_WINDOWS) expect(HEAT_WINDOW_LABEL[w]).toBe('最近 ' + w + ' 周')
  })
})
