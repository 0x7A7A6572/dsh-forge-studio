/**
 * 趋势图 —— echarts（树摇引入：只注册柱 / 折线 + 网格 / tooltip / canvas 渲染器）。
 *
 * 三条设计约束：
 *
 * 1. **颜色从宿主 token 现读**（`getComputedStyle` 读 `--dsw-alias-state-business-primary`）。
 *    echarts 画在 canvas 上，canvas 不认识 `var(--x)` —— 若把 CSS 变量字符串直接喂给
 *    itemStyle，得到的是一块黑色的兜底色。主题切换时用 MutationObserver 重读一次。
 * 2. **canvas 不可用时退到手绘 SVG 柱状图**（`chart.tsx` 的 BarChart）：jsdom / 无 GPU 的
 *    环境里 echarts.init 会抛，这里必须有一个可解释的出口，而不是留一块空白。
 *    （副作用是趋势页的单测跑的就是这条降级路径 —— 它是真代码，不是 mock。）
 * 3. 报错只 warn 不抛：图表挂了不该把整个弹窗带崩。
 */

import { useEffect, useRef, useState } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { BarChart } from './chart.tsx'

/** echarts 在 canvas 上画，取不到 CSS 变量字符串的解析值时必须有一个兜底色。 */
const FALLBACK_COLOR = '#4d6bfe'
const COLOR_TOKEN = '--dsw-alias-state-business-primary'

function readTokenColor(el: Element, name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/**
 * 能不能真的画 canvas？
 *
 * **必须在 init 之前探测**：在 jsdom / 无 canvas 的环境里 `echarts.init` 不会抛 ——
 * zrender 会把 `getContext('2d')` 返回的 null 一路带到绘制阶段，结果是「界面一片空白」
 * 加之后 `dispose()` 里的 TypeError（就是踩过的那个坑）。所以只能自己先要一块 2d 上下文。
 */
function canRenderCanvas(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    if (typeof canvas.getContext !== 'function') return false
    const ctx = canvas.getContext('2d')
    return ctx !== null && ctx !== undefined
  } catch {
    // 某些实现在「不支持 canvas」时是抛错而不是返回 null。
    return false
  }
}

export interface TrendChartProps {
  option: EChartsCoreOption
  /** 降级路径（手绘 SVG）画的内容：柱高与 tooltip 都走这两个字段。 */
  fallback: { values: number[]; labels: string[]; formatValue: (value: number) => string }
  height?: number
}

export function TrendChart(props: TrendChartProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const height = props.height ?? 180

  useEffect(() => {
    // 降级分支下没有容器（也就不用初始化）：effect 直接不干活。
    if (failed) return
    const host = hostRef.current
    if (host === null) return
    if (!canRenderCanvas()) {
      // 预期内的降级（jsdom、无 GPU 的宿主）：不是错误，不写日志，直接换手绘 SVG。
      setFailed(true)
      return
    }
    let chart: { setOption: (option: EChartsCoreOption) => void; resize: () => void; dispose: () => void } | null = null
    let cancelled = false

    void (async () => {
      try {
        // 动态 import：echarts 只在真的渲染图表时才进**执行**路径（侧栏入口卡与不打开趋势页的
        // 会话都不付它的解析开销）。注意 client 包是单文件 CJS 闭包，esbuild 不会为它切 chunk ——
        // 体积该涨还是涨（-1MB），这里省的只是「不执行」。
        const echarts = await import('echarts/core')
        const [{ BarChart: EBar, LineChart }, { GridComponent, TooltipComponent }, { CanvasRenderer }] = await Promise.all([
          import('echarts/charts'),
          import('echarts/components'),
          import('echarts/renderers'),
        ])
        echarts.use([EBar, LineChart, GridComponent, TooltipComponent, CanvasRenderer])
        if (cancelled) return
        const instance = echarts.init(host, undefined, { renderer: 'canvas' })
        chart = instance
        instance.setOption({ color: [readTokenColor(host, COLOR_TOKEN, FALLBACK_COLOR)], ...props.option })
        instance.resize()
      } catch (error: unknown) {
        if (cancelled) return
        // 刻意不把 error 抛出去：图表挂了不该连带整个弹窗崩掉。
        console.warn('[usage-billing] 图表渲染不可用，退到手绘柱状图', error)
        setFailed(true)
      }
    })()

    // 容器宽度变化（弹窗缩放 / 侧栏折叠）时 echarts 不会自己重排。
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { chart?.resize() })
      : null
    observer?.observe(host)
    // 主题切换会把 token 换成另一套值：重读一次并重设，否则暗色下还是亮色的蓝。
    const themeObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
        chart?.setOption({ color: [readTokenColor(host, COLOR_TOKEN, FALLBACK_COLOR)] })
      })
      : null
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })

    return () => {
      cancelled = true
      observer?.disconnect()
      themeObserver?.disconnect()
      // dispose 在异常路径上也可能抛（canvas 上下文已经没了）：收尾动作不该反过来
      // 把 React 的卸载流程炸掉。
      try { chart?.dispose() } catch { /* 收尾尽力而为 */ }
    }
  }, [failed, props.option])

  if (failed) {
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
