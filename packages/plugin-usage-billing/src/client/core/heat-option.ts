/**
 * 热力图的 echarts 配置（纯函数）。
 *
 * 用 echarts 的**日历坐标系**（calendar + visualMap + heatmap series）：这是「一年每天一格」
 * 的标准画法。此前那版是自己用 CSS grid 摞小方块 —— 不引库时够用，但代价是月份/星期的
 * 排布、色阶图例、每格 tooltip 全得自己实现，而且换月份范围就会错位。
 */

import type { EChartsCoreOption } from 'echarts/core'

export interface HeatPoint { day: string; value: number }

/** 色阶：0 档 → 顶档，由调用方从设计 token 读出来（canvas 不认 var()）。 */
export type HeatColors = readonly [string, string, string, string, string]

export function buildHeatOption(props: {
  points: readonly HeatPoint[]
  /** 日历范围，'YYYY-MM-DD'（含端点）。 */
  minDay: string
  maxDay: string
  colors: HeatColors
  formatDay: (day: string) => string
  formatValue: (value: number) => string
  /** 每格边框色（跟随卡片底色，让格子之间有呼吸感）。 */
  borderColor: string
  labelColor: string
}): EChartsCoreOption {
  const values = props.points.map((p) => p.value)
  const max = Math.max(0, ...values)
  return {
    // 图表本身已经有 tooltip：格子上再叠一个 echarts 的 tooltip 才是「悬停看当天金额」。
    tooltip: {
      trigger: 'item',
      formatter: (params: { value: [string, number] }): string => {
        const [day, value] = params.value
        return `${props.formatDay(day)}：${props.formatValue(value)}`
      },
    },
    visualMap: {
      show: false,
      min: 0,
      // max 为 0（整本账都没花钱）时给 1：min === max 会让 echarts 把色阶算成空白。
      max: max > 0 ? max : 1,
      inRange: { color: [...props.colors] },
    },
    calendar: {
      range: [props.minDay, props.maxDay],
      firstDay: 1,
      cellSize: ['auto', 13],
      top: 24,
      left: 28,
      right: 8,
      bottom: 8,
      splitLine: { show: false },
      itemStyle: { color: 'transparent', borderWidth: 2, borderColor: props.borderColor },
      dayLabel: { firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六'], color: props.labelColor, fontSize: 10 },
      monthLabel: { color: props.labelColor, fontSize: 10 },
      yearLabel: { show: false },
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: props.points.map((p) => [p.day, p.value]),
    }],
  }
}
