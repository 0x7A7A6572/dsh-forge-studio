/**
 * 把 echarts 力导向图挂到 div 上（探测 → 加载 → init → 重排 → 销毁）。
 *
 * 点击回调存进 ref：监听器在 init 时只注册一次，不能每次渲染重注册。
 */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { canRenderCanvas, loadEcharts } from '../core/graph-runtime.ts'
import type { EChartsEvent, EChartsHandle } from '../core/graph-runtime.ts'

export type GraphMode = 'pending' | 'echarts' | 'unsupported'

export interface GraphHost {
  hostRef: RefObject<HTMLDivElement>
  mode: GraphMode
}

export function useGraphHost(
  build: () => EChartsCoreOption,
  onClick?: (params: EChartsEvent) => void,
): GraphHost {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsHandle | null>(null)
  // build / onClick 每次渲染都进 ref：图表重设 option 时读到的是最新数据与最新回调。
  const buildRef = useRef(build)
  buildRef.current = build
  const clickRef = useRef(onClick)
  clickRef.current = onClick
  const [mode, setMode] = useState<GraphMode>('pending')

  useEffect(() => {
    if (mode === 'unsupported') return
    if (!canRenderCanvas()) { setMode('unsupported'); return }
    let cancelled = false
    let chart: EChartsHandle | null = null
    let resizeObserver: ResizeObserver | null = null
    let themeObserver: MutationObserver | null = null

    void (async () => {
      const echarts = await loadEcharts()
      const host = hostRef.current
      if (cancelled || host === null) return
      if (echarts === null) { setMode('unsupported'); return }
      try {
        chart = echarts.init(host, undefined, { renderer: 'canvas' })
        chartRef.current = chart
        chart.setOption(buildRef.current())
        chart.resize()
        chart.on('click', (params) => { clickRef.current?.(params) })
        setMode('echarts')
      } catch (error: unknown) {
        // 图谱挂了不该把整个弹窗带崩。
        console.warn('[memory] 图谱初始化失败', error)
        setMode('unsupported')
        return
      }
      // 容器尺寸变化（弹窗缩放 / 窗口拉伸）时 echarts 不会自己重排。
      resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => { chartRef.current?.resize() })
        : null
      resizeObserver?.observe(host)
      // 主题切换会换掉 token：重跑 build（它现读 token）。
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
      // dispose 在异常路径上也会抛：收尾动作不该反过来炸掉卸载流程。
      try { chart?.dispose() } catch { /* 收尾尽力而为 */ }
      chartRef.current = null
    }
  }, [mode])

  // 数据变化：同一个实例上重设 option（echarts 自己 diff，不重建 canvas）。
  useEffect(() => {
    if (mode !== 'echarts') return
    try { chartRef.current?.setOption(buildRef.current()) } catch { /* 保持上一帧 */ }
  })

  return { hostRef, mode }
}
