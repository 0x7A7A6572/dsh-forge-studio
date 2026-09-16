import { describe, expect, it } from 'vitest'
import { HEAT_SCALE, calendarMatrix, heatLevel } from '../src/client/core/heatmap.ts'

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
  it('分档阈值直接取自 HEAT_SCALE（改常量不改函数会红）', () => {
    const top = HEAT_SCALE.length - 1
    for (let level = 1; level < top; level += 1) {
      // HEAT_SCALE[level] 是第 level 档的右闭上界
      expect(heatLevel(HEAT_SCALE[level], 1), `上界 ${HEAT_SCALE[level]}`).toBe(level)
      // 区间内部代表值也落在同一档
      expect(heatLevel((HEAT_SCALE[level - 1] + HEAT_SCALE[level]) / 2, 1)).toBe(level)
    }
    // 超过倒数第二个阈值即顶档，到 HEAT_SCALE 上限仍然成立
    expect(heatLevel(HEAT_SCALE[top - 1] + 1e-9, 1)).toBe(4)
    expect(heatLevel(HEAT_SCALE[top], 1)).toBe(4)
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
  it('畸形日期被跳过（NaN 不能写成 row[NaN] 幻影属性）', () => {
    const m = calendarMatrix(['2026-09-01', 'abc-def-gh', '2026-09-02'], new Map(), { firstDayOfWeek: 1 })
    expect(m).toHaveLength(1)
    for (const week of m) {
      expect(week).toHaveLength(7)
      // 解构 'abc-def-gh' 得到的是 NaN 而不是 undefined：写入 row[NaN] 时
      // 数组长度看着还是 7，但键会多出一个。
      expect(Object.keys(week)).toHaveLength(7)
      expect(week.every((c) => c === null || /^\d{4}-\d{2}-\d{2}$/.test(c.day))).toBe(true)
    }
    expect(m.flat().filter(Boolean)).toHaveLength(2)
  })
  it('同一天重复出现被跳过，不能把一周拆成两行', () => {
    const m = calendarMatrix(
      ['2026-09-01', '2026-09-02', '2026-09-02'],
      new Map([['2026-09-02', 5]]),
      { firstDayOfWeek: 1 },
    )
    expect(m).toHaveLength(1)
    expect(m.flat().filter(Boolean)).toHaveLength(2)
    expect(m[0]![2]!.day).toBe('2026-09-02')
    expect(m[0]![2]!.value).toBe(5)
  })
  it('跨多周的缺口补空行：孤立的历史日期不能贴到窗口末尾', () => {
    // 'all' 路径会把 90 天窗口之前的历史日期前置到序列头部（view.ts 的 buildDaily）：
    // 2026-01-05 与 2026-03-02 都是周一，中间隔着 7 个整周。只推一行的话这两周会相邻，
    // 色阶的时间轴就读错了 —— 缺的每个整周都要补一个空行（行数 1 + 7 + 1 = 9）。
    const m = calendarMatrix(['2026-01-05', '2026-03-02'], new Map([['2026-03-02', 5]]), { firstDayOfWeek: 1 })
    expect(m).toHaveLength(9)
    expect(m[0]![0]!.day).toBe('2026-01-05')
    expect(m[8]![0]!.day).toBe('2026-03-02')
    for (const w of m.slice(1, 8)) expect(w.every((c) => c === null)).toBe(true)
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
