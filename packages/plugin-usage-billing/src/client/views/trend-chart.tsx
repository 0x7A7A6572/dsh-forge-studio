/**
 * 趋势图 —— echarts（柱 / 折线 + 网格 + tooltip）。
 *
 * 生命周期（能力探测、加载、token 取色、销毁、主题重设）都在 echarts-runtime.ts，
 * 这里只负责「拿不到 canvas 时画什么」。
 */

import type { EChartsCoreOption } from 'echarts/core'
import { BarChart } from './chart.tsx'
import { FALLBACK_LINE, readToken, useChartHost } from './echarts-runtime.ts'

const COLOR_TOKEN = '--dsw-alias-state-business-primary'

export interface TrendChartProps {
  option: EChartsCoreOption
  /** 降级路径（手绘 SVG）画的内容：柱高与 tooltip 都走这两个字段。 */
  fallback: { values: number[]; labels: string[]; formatValue: (value: number) => string }
  height?: number
}

export function TrendChart(props: TrendChartProps): JSX.Element {
  const height = props.height ?? 180
  // build 每次渲染重跑：token 现读，主题切换时由 runtime 再调一次。
  const { hostRef, mode } = useChartHost(() => ({
    color: [readToken(COLOR_TOKEN, FALLBACK_LINE)],
    ...props.option,
  }))

  if (mode === 'fallback') {
    return (
      <div className="ub-chart-fallback" style={{ height }}>
        <BarChart
          values={props.fallback.values}
          labels={props.fallback.labels}
          width={960}
          height={height}
          formatValue={props.fallback.formatValue}
        />
      </div>
    )
  }
  return (
    <div
      ref={hostRef}
      className="ub-chart"
      style={{ height }}
      role="img"
      aria-label="柱状图"
      data-dsh-ub-chart
    />
  )
}
