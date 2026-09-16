import { describe, expect, it } from 'vitest'
import { barGeometry, sparklinePoints } from '../src/client/core/chart-data.ts'

describe('chart-data', () => {
  it('sparkline 端点落在画布内，y 轴反向', () => {
    const p = sparklinePoints([0, 10], 100, 20).split(' ').map((s) => s.split(',').map(Number))
    expect(p[0]).toEqual([0, 20])
    expect(p[1]).toEqual([100, 0])
  })
  it('sparkline 全等值时不产生 NaN（走中线）', () => {
    expect(sparklinePoints([5, 5, 5], 100, 20)).toBe('0,10 50,10 100,10')
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
})
