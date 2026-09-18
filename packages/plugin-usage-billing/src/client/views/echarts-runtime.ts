/**
 * echarts 运行时：一次性注册、能力探测、token 取色、挂载/销毁。
 *
 * 图表有**两种实现**，这里管的是「什么时候用哪一种」：
 * - 有 canvas 2D 上下文 → echarts（趋势图、热力图）。
 * - 没有（jsdom、无 GPU 的宿主）→ 调用方给的降级实现（手绘 SVG / CSS grid）。
 *   探测必须在 init **之前**：echarts.init 在拿不到 2d 上下文时不会抛，会把 null 一路带到
 *   绘制阶段 —— 结果是空白图 + 之后 dispose() 里的 TypeError（真踩过）。
 *
 * 颜色一律从设计 token 现读：canvas 不认识 var(--x)，把变量字符串喂给 itemStyle 只会得到
 * 一块兜底色。读取点用 documentElement —— 自定义属性沿 DOM 继承，不需要先有宿主元素。
 */

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { EChartsCoreOption } from 'echarts/core'

/** token 读不到时的兜底色（暗色主题下的品牌蓝）。 */
export const FALLBACK_LINE = '#4d6bfe'

/** 热力图色阶的兜底：0 档 → 顶档。 */
export const FALLBACK_HEAT: readonly [string, string, string, string, string] = [
  '#20232b', '#2b3550', '#35477a', '#4159a4', '#4d6bfe',
]

export function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/**
 * 用一块 1×1 canvas 把任意 CSS 颜色归一化成具体颜色。
 *
 * canvas 不认 var()，也不认 `color-mix()` 这类函数 —— 但浏览器的 CSS 颜色解析器认得，
 * 把 `fillStyle` 赋一次再读回来就得到了算好的 rgb/hex。赋值失败时 fillStyle 不变，
 * 用哨兵色对比即可判定，避免把「没解析成功」当成黑色用。
 */
export function resolveCssColor(value: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx === null) return fallback
    ctx.fillStyle = '#010203'
    ctx.fillStyle = value
    const out = ctx.fillStyle
    if (typeof out !== 'string' || out === '' || out === '#010203') return fallback
    return out
  } catch {
    return fallback
  }
}

export function canRenderCanvas(): boolean {
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

export interface EChartsHandle {
  setOption: (option: EChartsCoreOption) => void
  resize: () => void
  dispose: () => void
}

interface EChartsModule {
  init: (host: HTMLElement, theme: undefined, opts: { renderer: 'canvas' }) => EChartsHandle
}

let loading: Promise<EChartsModule | null> | null = null

/**
 * 加载并注册 echarts（只做一次）。
 *
 * 动态 import：echarts 只在真的要画图时才进**执行**路径。注意 client 包是单文件 CJS 闭包，
 * 构建预设开了 inlineDynamicImports（见 scripts/vite.client.mjs），不会为它切 chunk
 * —— 体积该涨还是涨，这里省的只是「不执行」。
 */
export function loadEcharts(): Promise<EChartsModule | null> {
  loading ??= (async (): Promise<EChartsModule | null> => {
    try {
      const [core, charts, components, renderers] = await Promise.all([
        import('echarts/core'),
        import('echarts/charts'),
        import('echarts/components'),
        import('echarts/renderers'),
      ])
      core.use([
        charts.BarChart, charts.LineChart, charts.HeatmapChart,
        components.GridComponent, components.TooltipComponent,
        components.CalendarComponent, components.VisualMapComponent,
        renderers.CanvasRenderer,
      ])
      return core as unknown as EChartsModule
    } catch (error: unknown) {
      console.warn('[usage-billing] echarts 加载失败，图表退回手绘实现', error)
      loading = null
      return null
    }
  })()
  return loading
}

export type ChartMode = 'pending' | 'echarts' | 'fallback'

export interface ChartHost {
  hostRef: RefObject<HTMLDivElement>
  mode: ChartMode
}

/**
 * 把一个 echarts 实例挂到 div 上。
 *
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
