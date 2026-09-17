/**
 * 热力图 —— echarts 日历坐标系（calendar + heatmap series + visualMap 色阶）。
 *
 * 为什么改用 echarts：此前是自己用 CSS grid 摞小方块。不引库时够用，但月份/星期的排布、
 * 色阶、每格 tooltip 全得自己实现，一年范围还得自己算行数。calendar 坐标系就是为这个场景
 * 准备的：给一个日期范围，它自己排日历、自己带月份与星期标签。
 *
 * 降级：拿不到 canvas 2D 上下文时退回原来的 CSS grid（jsdom 单测跑的就是这条路径）。
 */

import { calendarMatrix } from '../core/heatmap.ts'
import { buildHeatOption } from '../core/heat-option.ts'
import type { HeatColors } from '../core/heat-option.ts'
import { NON_FINITE_PLACEHOLDER, formatCny, formatDay } from '../core/format.ts'
import { FALLBACK_HEAT, readToken, resolveCssColor, useChartHost } from './echarts-runtime.ts'
import type { DailyPoint } from '../../view.ts'

/** 解析成 [r,g,b]；解析不了返回 null（调用方退到兜底色阶）。 */
function toRgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex !== null) {
    const n = Number.parseInt(hex[1]!, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color)
  if (rgb !== null) {
    const parts = rgb[1]!.split(',').map((s) => Number.parseFloat(s.trim()))
    if (parts.length >= 3 && parts[0]! + parts[1]! + parts[2]! >= 0) {
      return [parts[0]!, parts[1]!, parts[2]!]
    }
  }
  return null
}

function mixColors(a: string, b: string, ratio: number): string {
  const ca = toRgb(a)
  const cb = toRgb(b)
  if (ca === null || cb === null) return ratio < 0.5 ? a : b
  const mix = (i: number): number => Math.round(ca[i]! + (cb[i]! - ca[i]!) * ratio)
  return 'rgb(' + mix(0) + ', ' + mix(1) + ', ' + mix(2) + ')'
}

/**
 * 5 档色阶：0 档 = 卡片底色，顶档 = 业务色，中间三档按 25/50/75% 混出来。
 * 与 ui-css.ts 的 color-mix 阶梯同形，但 canvas 只认算好的具体颜色。
 */
function heatColors(): HeatColors {
  const base = resolveCssColor(readToken('--dsw-alias-bg-layer-2', FALLBACK_HEAT[0]), FALLBACK_HEAT[0])
  const top = resolveCssColor(readToken('--dsw-alias-state-business-primary', FALLBACK_HEAT[4]), FALLBACK_HEAT[4])
  return [base, mixColors(base, top, 0.25), mixColors(base, top, 0.5), mixColors(base, top, 0.75), top]
}

/**
 * 色阶图例（少 → 多）。
 *
 * 与降级矩阵、echarts 的 visualMap 共用同一条 5 档色阶：档位定义只有 heatmap.ts 的
 * HEAT_SCALE 一处，颜色只有 ui-css.ts 一处，这里只摆 5 个方块。
 */
export function HeatLegend(): JSX.Element {
  return (
    <span className="ub-heatlegend" data-dsh-ub-heat-legend aria-hidden="true">
      <span className="ub-heatlegend-label">少</span>
      {[0, 1, 2, 3, 4].map((level) => (
        <i key={level} className="ub-heatlegend-swatch" data-level={level} />
      ))}
      <span className="ub-heatlegend-label">多</span>
    </span>
  )
}

export interface HeatChartProps {
  days: readonly DailyPoint[]
  /** 整份账未定价：每格金额都不可信，提示统一走占位符。 */
  unpriced: boolean
  height?: number
}

export function HeatChart(props: HeatChartProps): JSX.Element {
  const height = props.height ?? 200
  const { days, unpriced } = props
  const minDay = days.reduce((min, d) => (d.day < min ? d.day : min), days[0]?.day ?? '')
  const maxDay = days.reduce((max, d) => (d.day > max ? d.day : max), days[0]?.day ?? '')
  const cellTitle = (day: string, value: number): string =>
    day + '：' + (unpriced ? NON_FINITE_PLACEHOLDER : formatCny(value))

  const { hostRef, mode } = useChartHost(() => buildHeatOption({
    points: days.map((d) => ({ day: d.day, value: d.costCny })),
    minDay,
    maxDay,
    colors: heatColors(),
    formatDay,
    formatValue: (value) => (unpriced ? NON_FINITE_PLACEHOLDER : formatCny(value)),
    borderColor: resolveCssColor(readToken('--dsw-alias-bg-module-platform', '#16181d'), '#16181d'),
    labelColor: resolveCssColor(readToken('--dsw-alias-label-tertiary', '#8b8f98'), '#8b8f98'),
  }))

  if (mode === 'fallback') {
    const matrix = calendarMatrix(
      days.map((d) => d.day),
      new Map(days.map((d) => [d.day, d.costCny])),
      { firstDayOfWeek: 1 },
    )
    return (
      <div className="ub-heat" data-dsh-ub-heat role="img" aria-label="每日费用热力图">
        {matrix.flat().map((cell, i) => (
          <span
            key={cell?.day ?? 'pad-' + i}
            data-level={cell?.level ?? 0}
            title={cell === null ? '' : cellTitle(cell.day, cell.value)}
          />
        ))}
      </div>
    )
  }
  return (
    <div
      ref={hostRef}
      className="ub-chart"
      style={{ height }}
      role="img"
      aria-label="每日费用热力图"
      data-dsh-ub-heat-chart
    />
  )
}
