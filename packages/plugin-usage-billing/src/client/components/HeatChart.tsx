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
import { heatColors } from '../core/heat-color.ts'
import { NON_FINITE_PLACEHOLDER, formatCny, formatDay } from '../core/format.ts'
import { readToken, resolveCssColor } from '../core/chart-tokens.ts'
import { useChartHost } from '../hooks/useChartHost.ts'
import type { DailyPoint } from '../../view.ts'
import styles from '../styles/settings-section.module.css'

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
      <div className={styles.heat} data-dsh-ub-heat role="img" aria-label="每日费用热力图">
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
      className={styles.chart}
      style={{ height }}
      role="img"
      aria-label="每日费用热力图"
      data-dsh-ub-heat-chart
    />
  )
}
