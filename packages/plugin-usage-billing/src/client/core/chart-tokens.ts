/**
 * echarts 运行时里与 React 无关的那半：能力探测、token 取色、模块加载。
 *
 * 颜色一律从设计 token 现读：canvas 不认识 var(--x)，把变量字符串喂给 itemStyle 只会得到
 * 一块兜底色。读取点用 documentElement —— 自定义属性沿 DOM 继承，不需要先有宿主元素。
 */
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

/**
 * 探测能否真的画 canvas。
 *
 * 必须在 echarts.init **之前**：init 在拿不到 2d 上下文时不会抛，会把 null 一路带到绘制
 * 阶段 —— 结果是空白图 + 之后 dispose() 里的 TypeError（真踩过）。
 */
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

export interface EChartsModule {
  init: (host: HTMLElement, theme: undefined, opts: { renderer: 'canvas' }) => EChartsHandle
}

let loading: Promise<EChartsModule | null> | null = null

/**
 * 加载并注册 echarts（只做一次）。
 *
 * 动态 import：echarts 只在真的要画图时才进**执行**路径。注意 client 包是单文件 CJS 闭包，
 * 构建预设关了 codeSplitting（见 scripts/tsdown.client.mjs），不会为它切 chunk
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
