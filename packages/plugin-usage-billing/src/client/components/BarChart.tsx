/** 自绘 SVG 柱状图（无图表库、无外链）：canvas 不可用时的降级实现。 */
import { barGeometry } from '../core/chart-data.ts'

/**
 * `formatValue` 是**必填**的：tooltip 曾经直接插值 `props.values[i]`，把
 * `1234.5678901234` 这种原始浮点印给用户，绕过了 `core/format.ts` 这个唯一的金额格式化
 * 来源。调用方（趋势页）按当前指标（费用 / Token）各自传对应的格式化函数。
 */
export function BarChart(props: {
  values: number[]; labels: string[]; width: number; height: number; color?: string
  formatValue: (value: number) => string
}): JSX.Element {
  const bars = barGeometry(props.values, props.width, props.height)
  const slot = bars.length === 0 ? 0 : props.width / bars.length
  return (
    <svg width={props.width} height={props.height} role="img" aria-label="柱状图" data-dsh-usage-billing>
      {bars.map((b, i) => (
        <rect
          key={props.labels[i] ?? i}
          x={b.x + slot * 0.15}
          y={b.y}
          width={Math.max(1, b.w * 0.7)}
          height={b.h}
          fill={props.color ?? 'var(--dsw-alias-brand-primary)'}
          rx={1}
        >
          <title>{`${props.labels[i] ?? ''}: ${props.formatValue(props.values[i]!)}`}</title>
        </rect>
      ))}
    </svg>
  )
}
