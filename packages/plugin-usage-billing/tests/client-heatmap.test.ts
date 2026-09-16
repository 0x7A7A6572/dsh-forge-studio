import { describe, expect, it } from 'vitest'
import { calendarMatrix, heatLevel } from '../src/client/core/heatmap.ts'

describe('heatLevel', () => {
  it('五档分档边界', () => {
    expect(heatLevel(0, 100)).toBe(0)
    expect(heatLevel(1, 100)).toBe(1)
    expect(heatLevel(25, 100)).toBe(1)
    expect(heatLevel(25.1, 100)).toBe(2)
    expect(heatLevel(75, 100)).toBe(3)
    expect(heatLevel(100, 100)).toBe(4)
  })
  it('max 为 0 时全部 0 档（不产生 NaN）', () => {
    expect(heatLevel(0, 0)).toBe(0)
    expect(heatLevel(5, 0)).toBe(0)
  })
})

describe('calendarMatrix', () => {
  const days = ['2026-09-01', '2026-09-02', '2026-09-03']
  it('按周分行，行内按星期定位，空位为 null', () => {
    const m = calendarMatrix(days, new Map([['2026-09-02', 10]]), { firstDayOfWeek: 1 })
    expect(m.length).toBeGreaterThan(0)
    const flat = m.flat().filter(Boolean)
    expect(flat).toHaveLength(3)
    expect(flat.find((c) => c!.day === '2026-09-02')!.value).toBe(10)
  })
  it('每行长度恒为 7', () => {
    for (const week of calendarMatrix(days, new Map(), { firstDayOfWeek: 1 })) expect(week).toHaveLength(7)
  })
  it('空输入返回空矩阵', () => {
    expect(calendarMatrix([], new Map())).toEqual([])
  })
  it('跨周必须分行：整周回绕（列号递减）不能并进同一行', () => {
    // firstDayOfWeek: 1（周一）下，2026-09-01 起连续 7 天覆盖周二..下周一，
    // 列号序列为 1,2,3,4,5,6,0 —— 最后一天回绕到列 0。只看「列号是否被占」
    // 时列 0 恰好空着，整周会被压进同一行（Task 22 热力图会退化成一行）。
    // 行键必须是周起点：09-01 与 09-07 的 dayNum-col 不同，故必须分成两行。
    const week = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']
    const m = calendarMatrix(week, new Map([['2026-09-02', 10]]), { firstDayOfWeek: 1 })
    expect(m).toHaveLength(2)
    for (const w of m) expect(w).toHaveLength(7)
    const rowOf = (day: string) => m.findIndex((w) => w.some((c) => c?.day === day))
    for (const day of week.slice(0, 6)) expect(rowOf(day), day).toBe(0)
    expect(rowOf('2026-09-07')).toBe(1)
    expect(m[0]![2]!.day).toBe('2026-09-02')
    expect(m[0]![2]!.value).toBe(10)
  })
})
