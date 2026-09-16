import { describe, expect, it } from 'vitest'
import { barGeometry, sparklinePoints } from '../src/client/core/chart-data.ts'

/** 每个坐标都必须有限，且落在 [0,width] × [0,height] 画布内。 */
function expectInsideCanvas(points: string, width: number, height: number): void {
  for (const point of points.split(' ')) {
    const [x, y] = point.split(',').map(Number)
    expect(Number.isFinite(x), `${point} 的 x 必须有限`).toBe(true)
    expect(Number.isFinite(y), `${point} 的 y 必须有限`).toBe(true)
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThanOrEqual(width)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(height)
  }
}

/** `undefined` 混进 number 序列：真实数据里缺字段就是这个形状（运行时会传进来）。 */
const NON_FINITE = [NaN, Infinity, -Infinity, undefined] as unknown as number[]

describe('chart-data', () => {
  it('sparkline 端点落在画布内，y 轴反向', () => {
    const p = sparklinePoints([0, 10], 100, 20).split(' ').map((s) => s.split(',').map(Number))
    expect(p[0]).toEqual([0, 20])
    expect(p[1]).toEqual([100, 0])
  })
  it('sparkline 全等值走中线（height=7 → 3.5，取等值分支与取比例分支的值不同）', () => {
    // height 取 7 而非常见的 20：若 span===0 分支被改成 (v-min)/span = 0/0，
    // 输出会变成 NaN 而不是中线；若该分支误写成 ratio=1，y 会是 0。两者都会在此红。
    expect(sparklinePoints([5, 5, 5], 100, 7)).toBe('0,3.5 50,3.5 100,3.5')
  })
  it('空数组返回空串', () => {
    expect(sparklinePoints([], 100, 20)).toBe('')
  })
  it('柱状几何：等宽、按最大值归一、零值高度为 0', () => {
    const g = barGeometry([0, 10], 100, 20)
    expect(g[0]).toMatchObject({ x: 0, w: 50, h: 0 })
    expect(g[1]).toMatchObject({ x: 50, w: 50, h: 20, y: 0 })
  })
  it('柱状全 0 不产生 NaN', () => {
    expect(barGeometry([0, 0], 100, 20).every((b) => Number.isFinite(b.h) && b.h === 0)).toBe(true)
  })

  it('sparkline 把非有限值当 0：坐标全部有限且在画布内', () => {
    const points = sparklinePoints([0, 10, ...NON_FINITE], 100, 20)
    expect(points).not.toContain('NaN')
    expectInsideCanvas(points, 100, 20)
    // 「非有限当 0」是**可观察**的口径：把 10 当最大、0 当最小，第三个点（值 0）落在基线。
    expect(points.split(' ')[2]).toBe('40,20')
  })
  it('sparkline 负值：仍按最小/最大归一，坐标有限且在画布内', () => {
    const points = sparklinePoints([-5, 10], 100, 20)
    expect(points).not.toContain('NaN')
    expectInsideCanvas(points, 100, 20)
  })

  it('柱状图把非有限值当 0，且几何不越出画布', () => {
    const g = barGeometry([0, 10, ...NON_FINITE], 100, 20)
    for (const b of g) {
      for (const n of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(n)).toBe(true)
      expect(b.h).toBeGreaterThanOrEqual(0)
      expect(b.h).toBeLessThanOrEqual(20)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeLessThanOrEqual(20)
      expect(b.y + b.h).toBeLessThanOrEqual(20)
    }
    // 非有限 → 0（文档化口径）：第 3 个（原 NaN）零高、贴底。
    expect(g[2]).toMatchObject({ h: 0, y: 20 })
  })
  it('柱状图负值被夹平：柱高不为负、y/h 不越界（负值画到框外是原 bug）', () => {
    const g = barGeometry([-5, 10], 100, 20)
    expect(g[0]).toMatchObject({ h: 0, y: 20 })
    expect(g[1]).toMatchObject({ h: 20, y: 0 })
    const sum = barGeometry([-3, 6], 100, 20)
    for (const b of [...g, ...sum]) {
      expect(b.h).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y + b.h).toBeLessThanOrEqual(20)
    }
  })
})
