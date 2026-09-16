/**
 * 趋势图配置的纯函数测试。
 *
 * 为什么要单独测它：图表本体（echarts 实例）在 jsdom 里跑不起来（没有 canvas 2D 上下文，
 * 会按设计降级到手绘 SVG），所以「配置里到底放进了什么」只能在这一层钉住 ——
 * 而这一层恰恰是出过 bug 的地方（曾把 1234.5678901234 这种原始浮点直接印给用户）。
 */

import { describe, expect, it } from 'vitest'
import { buildTrendOption } from '../src/client/core/trend-option.ts'

/** 配置是 EChartsCoreOption（宽松对象类型）；这里按用到的字段收窄，避免 any 满天飞。 */
interface OptionView {
  xAxis: { data: string[] }
  yAxis: { axisLabel: { formatter: (value: string) => string } }
  tooltip: { valueFormatter: (value: unknown) => string }
  series: Array<{ type: string; data: number[] }>
}

const view = (option: ReturnType<typeof buildTrendOption>): OptionView => option as unknown as OptionView

const points = [
  { day: '2026-09-15', value: 1234.5678901234 },
  { day: '2026-09-16', value: 2 },
]

describe('buildTrendOption', () => {
  it('x 轴走 formatDay、series 按输入顺序取点（不重排、不聚合）', () => {
    const option = view(buildTrendOption({
      points,
      formatDay: (day) => day.slice(5),
      formatValue: (n) => String(n),
    }))
    expect(option.xAxis.data).toEqual(['09-15', '09-16'])
    expect(option.series[0]!.data).toEqual([1234.5678901234, 2])
  })

  it('tooltip 与 y 轴共用同一个格式化出口：配置里不留原始浮点', () => {
    const option = view(buildTrendOption({
      points,
      formatDay: (day) => day,
      // 唯一格式化来源：调用方传什么就用什么（费用传 formatCny、Token 传 formatInt）。
      formatValue: (n) => '¥' + n.toFixed(2),
    }))
    expect(option.tooltip.valueFormatter(1234.5678901234)).toBe('¥1234.57')
    expect(option.yAxis.axisLabel.formatter('1234.5678901234')).toBe('¥1234.57')
    expect(option.series[0]!.data).toContain(1234.5678901234)
  })

  it('点太密时画折线，稀疏时画柱状', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ day: '2026-09-' + String(i + 1).padStart(2, '0'), value: i }))
    const seven = many.slice(0, 7)
    const build = (list: typeof points): OptionView => view(buildTrendOption({
      points: list, formatDay: (d) => d, formatValue: (n) => String(n), line: list.length > 14,
    }))
    expect(build(many).series[0]!.type).toBe('line')
    expect(build(seven).series[0]!.type).toBe('bar')
  })
})
