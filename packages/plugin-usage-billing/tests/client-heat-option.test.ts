/**
 * 热力图配置的纯函数测试。
 *
 * 图表本体（echarts 实例）在 jsdom 里画不出来（没有 canvas 2D 上下文，按设计降级到
 * CSS grid），所以「日历范围、色阶、tooltip 格式化」这些只能在这一层钉住。
 */

import { describe, expect, it } from 'vitest'
import { buildHeatOption } from '../src/client/core/heat-option.ts'
import type { HeatColors } from '../src/client/core/heat-option.ts'

interface OptionView {
  calendar: { range: [string, string] }
  visualMap: { min: number; max: number; inRange: { color: string[] } }
  tooltip: { formatter: (params: { value: [string, number] }) => string }
  series: Array<{ type: string; coordinateSystem: string; data: Array<[string, number]> }>
}

const COLORS: HeatColors = ['#000001', '#000002', '#000003', '#000004', '#000005']

const view = (option: ReturnType<typeof buildHeatOption>): OptionView => option as unknown as OptionView

describe('buildHeatOption', () => {
  it('走日历坐标系：范围逐字传给 calendar，series 是 calendar 上的 heatmap', () => {
    const option = view(buildHeatOption({
      points: [{ day: '2026-09-01', value: 1 }, { day: '2026-09-02', value: 2 }],
      minDay: '2026-09-01', maxDay: '2026-09-30',
      colors: COLORS,
      formatDay: (day) => day, formatValue: (n) => String(n),
      borderColor: '#111111', labelColor: '#999999',
    }))
    expect(option.calendar.range).toEqual(['2026-09-01', '2026-09-30'])
    expect(option.series[0]!.type).toBe('heatmap')
    expect(option.series[0]!.coordinateSystem).toBe('calendar')
    expect(option.series[0]!.data).toEqual([['2026-09-01', 1], ['2026-09-02', 2]])
    expect(option.visualMap.inRange.color).toEqual([...COLORS])
  })

  it('tooltip 格式化走调用方给的出口（不印原始浮点，未定价走占位符）', () => {
    const option = view(buildHeatOption({
      points: [{ day: '2026-09-01', value: 1.234567 }],
      minDay: '2026-09-01', maxDay: '2026-09-01',
      colors: COLORS,
      formatDay: (day) => day.slice(5),
      formatValue: (n) => (n === 0 ? '—' : '¥' + n.toFixed(2)),
      borderColor: '#111111', labelColor: '#999999',
    }))
    expect(option.tooltip.formatter({ value: ['2026-09-01', 1.234567] })).toBe('09-01：¥1.23')
    expect(option.tooltip.formatter({ value: ['2026-09-01', 0] })).toBe('09-01：—')
  })

  it('全都为 0 时 max 取 1：min === max 会让 echarts 把色阶算成空白', () => {
    const option = view(buildHeatOption({
      points: [{ day: '2026-09-01', value: 0 }],
      minDay: '2026-09-01', maxDay: '2026-09-01',
      colors: COLORS,
      formatDay: (day) => day, formatValue: (n) => String(n),
      borderColor: '#111111', labelColor: '#999999',
    }))
    expect(option.visualMap.min).toBe(0)
    expect(option.visualMap.max).toBe(1)
  })

  it('max 取实际最大值（色阶要贴着真实数据，不是固定刻度）', () => {
    const option = view(buildHeatOption({
      points: [{ day: '2026-09-01', value: 3 }, { day: '2026-09-02', value: 9.5 }],
      minDay: '2026-09-01', maxDay: '2026-09-02',
      colors: COLORS,
      formatDay: (day) => day, formatValue: (n) => String(n),
      borderColor: '#111111', labelColor: '#999999',
    }))
    expect(option.visualMap.max).toBe(9.5)
  })
})
