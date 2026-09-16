/**
 * 趋势图配置（纯函数，DOM-free，可单测）。
 *
 * 抽出来的理由：图表本体是命令式的（echarts 实例），而**真正会出错的是数据与格式化** ——
 * 「1,234.5678901234 这种原始浮点被印给用户」正是这一层曾经的 bug。把配置构造做成纯函数，
 * 就能在没有 canvas 的环境里把 tooltip / 轴标签的格式化逐条钉住。
 */

import type { EChartsCoreOption } from 'echarts/core'

export interface TrendPoint {
  day: string
  value: number
}

export interface TrendOptionInput {
  points: readonly TrendPoint[]
  /** x 轴刻度文案（'2026-09-15' → '09-15'）。 */
  formatDay: (day: string) => string
  /**
   * tooltip 与 y 轴共用的**唯一**格式化出口：金额走 formatCny、Token 走 formatInt。
   * 绝不在配置里插值原始数字。
   */
  formatValue: (value: number) => string
  /** 点太密时用折线（30 天）；默认柱状。 */
  line?: boolean
}

export function buildTrendOption(input: TrendOptionInput): EChartsCoreOption {
  const values = input.points.map((point) => point.value)
  const labels = input.points.map((point) => input.formatDay(point.day))
  return {
    animationDuration: 200,
    grid: { left: 4, right: 8, top: 20, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: input.line === true ? 'line' : 'shadow' },
      // 格式化只此一处：配置里不留任何原始浮点。
      valueFormatter: (value: unknown) => input.formatValue(Number(value)),
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true },
      // 轴刻度也必须走同一个格式化：否则左边一列裸数字、tooltip 却是 ¥ 金额。
      axisLabel: { formatter: (value: string) => input.formatValue(Number(value)) },
    },
    series: [{
      type: input.line === true ? 'line' : 'bar',
      data: values,
      barMaxWidth: 22,
      smooth: true,
      symbol: 'none',
      emphasis: { focus: 'series' },
    }],
  }
}
