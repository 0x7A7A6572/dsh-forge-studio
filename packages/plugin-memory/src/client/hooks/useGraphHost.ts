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

/** 要求图谱点亮某个节点；seq 是重放键（同一个节点再点一次也要重新定位）。 */
export interface GraphFocus {
  /** 图谱节点 id（graphNodeId 那套 m:/e: 前缀）。 */
  readonly id: string
  readonly seq: number
}

export function useGraphHost(
  // 把宿主元素交给 build：颜色 token 得从图所在的元素现读（主题变量挂在 body 上）。
  build: (host: HTMLElement | null) => EChartsCoreOption,
  onClick?: (params: EChartsEvent) => void,
  focus?: GraphFocus,
): GraphHost {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsHandle | null>(null)
  // build / onClick 每次渲染都进 ref：图表重设 option 时读到的是最新数据与最新回调。
  const buildRef = useRef(build)
  buildRef.current = build
  const clickRef = useRef(onClick)
  clickRef.current = onClick
  const focusRef = useRef<GraphFocus | undefined>(focus)
  focusRef.current = focus
  const [mode, setMode] = useState<GraphMode>('pending')
  // 最近一次的 option 与「要定位但还没落地的节点」：两者都要等 setOption 之后才凑齐。
  const optionRef = useRef<EChartsCoreOption | null>(null)
  const pendingRef = useRef<string | null>(null)

  /**
   * 点亮某个节点：高亮它和它的邻边、其余变暗。
   * 不做居中 —— 力导向的节点一直在动，居中只会看着晃。
   */
  function applyFocus(): void {
    const chart = chartRef.current
    const id = pendingRef.current
    if (chart === null || id === null) return
    const series = (optionRef.current as { series?: readonly { data?: readonly { id?: string }[] }[] } | null)?.series?.[0]
    const data = series?.data
    if (data === undefined || data === null) return
    const index = data.findIndex((item) => item.id === id)
    // 节点不在当前范围（范围不符或超过记忆上限）：静默等下一条数据再说。
    if (index < 0) return
    pendingRef.current = null
    try {
      chart.dispatchAction({ type: 'focusNodeAdjacency', seriesIndex: 0, dataIndex: index })
    } catch { /* 定位失败不该把图带崩 */ }
  }

  /** 重设 option：记下它，并顺手处理还没落地的定位请求。 */
  function applyOption(opts?: { notMerge?: boolean }): void {
    const option = buildRef.current(hostRef.current)
    optionRef.current = option
    try { chartRef.current?.setOption(option, opts) } catch { /* 重建失败就保持上一帧 */ }
    applyFocus()
  }

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
        applyOption()
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
      // 主题切换会换掉 token：重跑 build（它现读 token），并且不合并 ——
      // 合并会把上一主题的颜色留在 data 里。
      themeObserver = typeof MutationObserver === 'function'
        ? new MutationObserver(() => { applyOption({ notMerge: true }) })
        : null
      // 两个挂点都盯：主题变量的作用域是 body（data-ds-dark-theme），宿主也会往 html 上挂 class。
      for (const target of [document.documentElement, document.body]) {
        themeObserver?.observe(target, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme', 'data-ds-dark-theme'],
        })
      }
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
    applyOption()
  })

  // 外部要求定位：目标先记进 ref，图就绪后由 applyOption 点亮。
  useEffect(() => {
    if (focus === undefined) return
    pendingRef.current = focus.id
    applyFocus()
  }, [focus])

  return { hostRef, mode }
}
