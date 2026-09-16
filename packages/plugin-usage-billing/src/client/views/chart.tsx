/** 自绘 SVG 图表件（无图表库、无外链）。 */

import { barGeometry, sparklinePoints } from '../core/chart-data.ts'

export function Sparkline(props: { values: number[]; width?: number; height?: number }): JSX.Element {
  const width = props.width ?? 120
  const height = props.height ?? 28
  const points = sparklinePoints(props.values, width, height)
  if (points === '') return <svg width={width} height={height} aria-hidden="true" />
  return (
    <svg width={width} height={height} aria-hidden="true" data-dsh-usage-billing>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

export function BarChart(props: {
  values: number[]; labels: string[]; width: number; height: number; color?: string
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
          <title>{`${props.labels[i] ?? ''}: ${props.values[i]}`}</title>
        </rect>
      ))}
    </svg>
  )
}
