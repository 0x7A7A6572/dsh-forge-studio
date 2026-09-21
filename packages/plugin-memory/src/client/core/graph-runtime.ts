/**
 * 图谱运行时里与 React 无关的那半：canvas 探测、设计 token 取色、echarts 按需加载。
 *
 * canvas 不认 var(--x)，颜色必须在 init 之前读成具体色值。
 */
import type { EChartsCoreOption } from 'echarts/core'
import type { MemoryEntityKind } from '../../types.ts'

/** token 读不到时的兜底色：挑两种主题下都还看得清的中间调。 */
const FALLBACK_TEXT = '#8a8f98'
const FALLBACK_DIM = '#8a8f98'
const FALLBACK_BLUE = '#4d6bfe'
const FALLBACK_GREEN = '#2fa36b'
const FALLBACK_SURFACE = '#2b2d33'

/** 类别的兜底色：色相与样式表里那组 --dsh-memory-kind-* 一一对应。主题无关，取中间调。 */
const FALLBACK_KIND: Record<MemoryEntityKind, string> = {
  project: FALLBACK_BLUE,
  tool: '#14b8a6',
  person: '#d64545',
  org: '#8b5cf6',
  concept: '#e08a2e',
  other: FALLBACK_DIM,
}

/**
 * 图谱调色板。
 *
 * 六个类别与列表徽标同源（样式表里的 --dsh-memory-kind-*）：两处各写一套必然漂。
 * 色相按蓝 / 青 / 红 / 紫 / 橙 / 灰拉开，圆点小也分得清。
 */
export interface GraphPalette {
  readonly memory: string
  readonly entity: Record<MemoryEntityKind, string>
  readonly edge: {
    readonly memoryEntity: string
    readonly memoryMemory: string
    readonly entityEntity: string
  }
  readonly text: string
  /** 悬浮提示的底色：ECharts 默认白底，在深色主题下是一块刺眼的白。 */
  readonly surface: string
}

export function readToken(name: string, fallback: string, scope?: HTMLElement | null): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  // 读 body 而不是 documentElement：--dsw-alias-* 定义在 body / body[data-ds-dark-theme] 上，
  // 自定义属性只往下继承 —— 从 html 读永远拿到空串，图谱会一直停在兜底色（踩过）。
  const element = scope ?? document.body
  if (element === null || element === undefined) return fallback
  const value = getComputedStyle(element).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/**
 * 把任意 CSS 颜色归一化成具体色值：canvas 同样不认 color-mix()。
 * 借 1×1 canvas 让浏览器的解析器算一遍，哨兵色用来识别「没解析成功」。
 */
export function resolveCssColor(value: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  try {
    const probe = document.createElement('canvas').getContext('2d')
    if (probe === null) return fallback
    probe.fillStyle = '#010203'
    probe.fillStyle = value
    const out = probe.fillStyle
    if (typeof out !== 'string' || out === '' || out === '#010203') return fallback
    return out
  } catch {
    return fallback
  }
}

/** 探测能否真画 canvas：echarts.init 拿不到 2d 上下文时不抛错，事后才炸。 */
export function canRenderCanvas(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    if (typeof canvas.getContext !== 'function') return false
    const probe = canvas.getContext('2d')
    return probe !== null && probe !== undefined
  } catch {
    return false
  }
}

/** 点击事件里我们只用得上这两样：是节点还是边、点的哪个节点。 */
export interface EChartsEvent {
  readonly dataType?: string
  readonly data?: { readonly id?: string }
}

export interface EChartsHandle {
  setOption: (option: EChartsCoreOption, opts?: { notMerge?: boolean }) => void
  /** 定位用：焦点邻接（focusNodeAdjacency）走 action 面。 */
  dispatchAction: (action: Record<string, unknown>) => void
  resize: () => void
  dispose: () => void
  on: (event: 'click', handler: (params: EChartsEvent) => void) => void
}

export interface EChartsModule {
  init: (host: HTMLElement, theme: undefined, opts: { renderer: 'canvas' }) => EChartsHandle
}

let loading: Promise<EChartsModule | null> | null = null

/**
 * 加载 echarts 并只注册图谱要用的图表与组件，只做一次。
 *
 * 动态 import 只推迟执行，不减体积（构建预设关了 code splitting）。
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
        charts.GraphChart,
        components.TooltipComponent,
        components.LegendComponent,
        renderers.CanvasRenderer,
      ])
      return core as unknown as EChartsModule
    } catch (error: unknown) {
      console.warn('[memory] echarts 加载失败，图谱不显示', error)
      loading = null
      return null
    }
  })()
  return loading
}

/** 现读一次调色板：传图谱容器进来会拿到它所在主题的实时值（主题切换后重建走这里）。 */
export function graphPalette(scope?: HTMLElement | null): GraphPalette {
  const token = (name: string, fallback: string): string =>
    resolveCssColor(readToken(name, fallback, scope), fallback)
  const kind = (name: MemoryEntityKind): string =>
    token('--dsh-memory-kind-' + name, FALLBACK_KIND[name])
  return {
    memory: token('--dsw-alias-label-secondary', FALLBACK_DIM),
    entity: {
      project: kind('project'),
      tool: kind('tool'),
      person: kind('person'),
      org: kind('org'),
      concept: kind('concept'),
      other: kind('other'),
    },
    edge: {
      memoryEntity: token('--dsw-alias-state-business-primary', FALLBACK_BLUE),
      memoryMemory: token('--dsw-alias-label-tertiary', FALLBACK_DIM),
      entityEntity: token('--dsw-alias-state-success-primary', FALLBACK_GREEN),
    },
    text: token('--dsw-alias-label-secondary', FALLBACK_TEXT),
    surface: token('--dsw-alias-bg-overlay', FALLBACK_SURFACE),
  }
}
