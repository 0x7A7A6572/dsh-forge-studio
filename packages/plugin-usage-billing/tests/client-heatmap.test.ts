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
})
