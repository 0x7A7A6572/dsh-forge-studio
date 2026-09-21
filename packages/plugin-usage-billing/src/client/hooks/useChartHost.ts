/**
 * 把一个 echarts 实例挂到 div 上（生命周期：能力探测 → 加载 → init → 销毁）。
 *
 * 图表有**两种实现**，这里决定「什么时候用哪一种」：有 canvas 2D 上下文 → echarts；
 * 没有（jsdom、无 GPU 的宿主）→ 调用方给的降级实现（手绘 SVG / CSS grid）。
 */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { canRenderCanvas, loadEcharts } from '../core/chart-tokens.ts'
import type { EChartsHandle } from '../core/chart-tokens.ts'

export type ChartMode = 'pending' | 'echarts' | 'fallback'

export interface ChartHost {
  hostRef: RefObject<HTMLDivElement>
  mode: ChartMode
}

/**
 * `build` 每次渲染都会被存进 ref（所以主题切换时它闭包里的数据仍然是最新的），
 * 图表在以下时机重设 option：数据/配置变化（每次渲染）、主题 token 变化。
 */
export function useChartHost(build: () => EChartsCoreOption): ChartHost {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsHandle | null>(null)
  const buildRef = useRef(build)
  buildRef.current = build
  const [mode, setMode] = useState<ChartMode>('pending')

  // 挂载：探测能力 → 加载 → init → 装观察者。
  useEffect(() => {
    if (mode === 'fallback') return
    if (!canRenderCanvas()) { setMode('fallback'); return }
    let cancelled = false
    let chart: EChartsHandle | null = null
    let resizeObserver: ResizeObserver | null = null
    let themeObserver: MutationObserver | null = null

    void (async () => {
      const echarts = await loadEcharts()
      const host = hostRef.current
      if (cancelled || host === null) return
      if (echarts === null) { setMode('fallback'); return }
      try {
        chart = echarts.init(host, undefined, { renderer: 'canvas' })
        chartRef.current = chart
        chart.setOption(buildRef.current())
        chart.resize()
        setMode('echarts')
      } catch (error: unknown) {
        // 图表挂了不该把整个弹窗带崩：warn + 退到降级实现。
        console.warn('[usage-billing] 图表初始化失败，退回降级实现', error)
        setMode('fallback')
        return
      }
      // 容器宽度变化（弹窗缩放 / 侧栏折叠）时 echarts 不会自己重排。
      resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => { chartRef.current?.resize() })
        : null
      resizeObserver?.observe(host)
      // 主题切换会把 token 换成另一套值：重跑一次 build（它现读 token）。
      themeObserver = typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
          try { chartRef.current?.setOption(buildRef.current()) } catch { /* 重建失败就保持上一帧 */ }
        })
        : null
      themeObserver?.observe(document.documentElement, {
        attributes: true, attributeFilter: ['class', 'data-theme', 'style'],
      })
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
      // dispose 在异常路径上也可能抛（canvas 上下文已经没了）：收尾动作不该反过来
      // 把 React 的卸载流程炸掉。
      try { chart?.dispose() } catch { /* 收尾尽力而为 */ }
      chartRef.current = null
    }
  }, [mode])

  // 数据/配置变化：同一个实例上重设 option（echarts 自己 diff，不重建 canvas）。
  useEffect(() => {
    if (mode !== 'echarts') return
    try { chartRef.current?.setOption(buildRef.current()) } catch { /* 保持上一帧 */ }
  })

  return { hostRef, mode }
}
