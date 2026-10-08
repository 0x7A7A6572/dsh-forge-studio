/**
 * 「线条 M」形状的几何与文案（纯函数，不碰 React / DOM）。
 * 横轴是注意力轴：峰窗两侧按 1:1 展开、深夜按 0.12 压扁，位置因此不等于时刻。
 * 渲染的路径与「现在」那颗点共用同一条样条，点因此永远压在线上。
 */
import { clockText, nowText, toneAtMinute, type TierTone } from './tier-curve.ts'

export interface LineShapeSource {
  readonly workday: boolean
  readonly peakWindows: readonly (readonly [number, number])[]
}

/** viewBox 宽度 = 横轴单位总数（不是分钟数）。 */
export const CURVE_WIDTH = 1440
/** mini 的 viewBox 高度：曲线只占第 4-26 行，上下各留 4 单位给描边。 */
export const MINI_CURVE_HEIGHT = 30

interface CurveGeometry {
  height: number
  /** 峰线（小 = 高）。 */
  peakY: number
  valleyY: number
}

const MINI: CurveGeometry = { height: MINI_CURVE_HEIGHT, peakY: 4, valleyY: 26 }
/** 纵向骨架（从下往上）：终点 26 → 起点 22 → 波谷 20 → 小峰 12 → 大峰 4。 */
const MINI_SUB_PEAK_Y = 12
const MINI_SADDLE_Y = 20
const MINI_RAMP_Y = 22
/** 峰窗两侧各按 1:1 展开的分钟数，更远的深夜才按 NIGHT_DENSITY 压扁。 */
const FOCUS_PAD_MINUTES = 90
const NIGHT_DENSITY = 0.12

export interface CurvePoint {
  minute: number
  x: number
  y: number
}

export interface CurveTone {
  offset: number
  tone: TierTone
}

export interface TierCurve {
  x(minute: number): number
  y(minute: number): number
  points: readonly CurvePoint[]
  line: string
  area: string
  tones: readonly CurveTone[]
}

interface AxisSpan {
  from: number
  to: number
  density: number
  base: number
}

function clampMinute(minute: number): number {
  return Math.min(Math.max(minute, 0), CURVE_WIDTH)
}

function focusRanges(profile: LineShapeSource): (readonly [number, number])[] {
  const ranges = profile.peakWindows
    .map(([from, to]): [number, number] => [
      clampMinute(from - FOCUS_PAD_MINUTES),
      clampMinute(to + FOCUS_PAD_MINUTES),
    ])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [from, to] of ranges) {
    const last = merged[merged.length - 1]
    if (last === undefined || from > last[1]) merged.push([from, to])
    else last[1] = Math.max(last[1], to)
  }
  return merged
}

function axisSpans(profile: LineShapeSource): { spans: AxisSpan[]; weight: number } {
  const spans: AxisSpan[] = []
  let cursor = 0
  let base = 0
  const add = (from: number, to: number, density: number): void => {
    if (to <= from) return
    spans.push({ from, to, density, base })
    base += (to - from) * density
  }
  for (const [from, to] of focusRanges(profile)) {
    add(cursor, from, NIGHT_DENSITY)
    add(from, to, 1)
    cursor = to
  }
  add(cursor, CURVE_WIDTH, NIGHT_DENSITY)
  return { spans, weight: base }
}

function tierAxis(profile: LineShapeSource): TierCurve['x'] {
  const { spans, weight } = axisSpans(profile)
  return (minute) => {
    const at = clampMinute(minute)
    for (const span of spans) {
      if (at < span.to) return ((span.base + (at - span.from) * span.density) / weight) * CURVE_WIDTH
    }
    return CURVE_WIDTH
  }
}

function miniPeakY(index: number, count: number, geom: CurveGeometry): number {
  if (count < 2) return geom.peakY
  const t = index / (count - 1)
  return MINI_SUB_PEAK_Y + (geom.peakY - MINI_SUB_PEAK_Y) * t
}

/** 折点：完全平滑的 M，峰窗不做平顶、只在窗口中点取一次顶；大峰到 24:00 不插锚点。 */
function smoothPoints(profile: LineShapeSource, x: TierCurve['x'], geom: CurveGeometry): CurvePoint[] {
  const windows = profile.peakWindows
    .map(([from, to]) => [clampMinute(from), clampMinute(to)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
  const points: CurvePoint[] = []
  const push = (minute: number, y: number): void => {
    const last = points[points.length - 1]
    const at = last === undefined ? clampMinute(minute) : Math.min(Math.max(minute, last.minute), CURVE_WIDTH)
    // 同一个 x 上只留后写的那个点，点列因此单调不减。
    if (last !== undefined && at === last.minute) {
      last.y = y
      return
    }
    points.push({ minute: at, x: x(at), y })
  }
  const first = windows[0]
  const startsOnPeak = first !== undefined && first[0] === 0
  push(0, startsOnPeak || first === undefined ? geom.valleyY : MINI_RAMP_Y)
  windows.forEach(([start, end], i) => {
    const mid = (start + end) / 2
    push(mid, miniPeakY(i, windows.length, geom))
    const next = windows[i + 1]
    if (next !== undefined) push((end + next[0]) / 2, MINI_SADDLE_Y)
  })
  push(CURVE_WIDTH, geom.valleyY)
  return points
}

type EndTangent = 'flat' | 'slant'

function assemble(
  x: TierCurve['x'],
  geom: CurveGeometry,
  points: CurvePoint[],
  ends: EndTangent,
  tones: CurveTone[],
): TierCurve {
  const slopes = slopesOf(points, ends)
  return {
    x,
    y: (minute) => yAt(points, slopes, x(minute)),
    points,
    line: linePath(points, slopes),
    area: areaPath(points, slopes, geom),
    tones,
  }
}

/** 色带切点 = 折点 ∪ 每个峰窗的两端；少了窗口端点，琥珀会一路糊到 24:00。 */
function miniTones(profile: LineShapeSource, x: TierCurve['x'], points: CurvePoint[]): CurveTone[] {
  const minutes = new Set(points.map((point) => point.minute))
  for (const [from, to] of profile.peakWindows) {
    minutes.add(clampMinute(from))
    minutes.add(clampMinute(to))
  }
  return [...minutes]
    .sort((a, b) => a - b)
    .map((minute) => ({ offset: x(minute) / CURVE_WIDTH, tone: toneAtMinute(profile, minute) }))
}

function coord(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * 每个折点的切线斜率（dy/dx）：Fritsch–Carlson 单调三次样条。
 * 只有真正的极值点取 0 斜率；端点取单侧割线斜切进出画布。
 */
function slopesOf(points: readonly CurvePoint[], ends: EndTangent): number[] {
  const count = points.length
  const secant: number[] = []
  for (let i = 0; i + 1 < count; i++) {
    const span = points[i + 1]!.x - points[i]!.x
    secant.push(span > 0 ? (points[i + 1]!.y - points[i]!.y) / span : 0)
  }
  const slopes = points.map((_, i) => {
    if (i === 0 || i === count - 1) {
      if (ends === 'flat') return 0
      return (i === 0 ? secant[0] : secant[count - 2]) ?? 0
    }
    const left = secant[i - 1]!
    const right = secant[i]!
    // 一侧平、或两侧反号 → 极值点，切线水平。
    if (left === 0 || right === 0 || left * right < 0) return 0
    const hPrev = points[i]!.x - points[i - 1]!.x
    const hNext = points[i + 1]!.x - points[i]!.x
    const wPrev = 2 * hNext + hPrev
    const wNext = hNext + 2 * hPrev
    return (wPrev + wNext) / (wPrev / left + wNext / right)
  })
  // 单调限幅：区间两端的切线都得落在单调域里，否则三次段会过冲。
  for (let i = 0; i + 1 < count; i++) {
    const delta = secant[i]!
    if (delta === 0) {
      slopes[i] = 0
      slopes[i + 1] = 0
      continue
    }
    if (slopes[i]! * delta < 0) slopes[i] = 0
    if (slopes[i + 1]! * delta < 0) slopes[i + 1] = 0
    const alpha = slopes[i]! / delta
    const beta = slopes[i + 1]! / delta
    if (alpha * alpha + beta * beta > 9) {
      const tau = 3 / Math.sqrt(alpha * alpha + beta * beta)
      slopes[i] = tau * alpha * delta
      slopes[i + 1] = tau * beta * delta
    }
  }
  return slopes
}

function linePath(points: readonly CurvePoint[], slopes: readonly number[]): string {
  const first = points[0]!
  let d = `M${coord(first.x)},${first.y}`
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (a.y === b.y) {
      d += `L${coord(b.x)},${b.y}`
      continue
    }
    const third = (b.x - a.x) / 3
    const lift = slopes[i - 1]! * third
    const drop = slopes[i]! * third
    d += `C${coord(a.x + third)},${coord(a.y + lift)} ${coord(b.x - third)},${coord(b.y - drop)} ${coord(b.x)},${b.y}`
  }
  return d
}

function areaPath(points: readonly CurvePoint[], slopes: readonly number[], geom: CurveGeometry): string {
  return `${linePath(points, slopes)}L${CURVE_WIDTH},${geom.height}L0,${geom.height}Z`
}

/** 横轴坐标 → 曲线高度：与 linePath 同一条三次 Hermite。 */
function yAt(points: readonly CurvePoint[], slopes: readonly number[], at: number): number {
  if (at <= points[0]!.x) return points[0]!.y
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (at > b.x) continue
    const span = b.x - a.x
    if (span <= 0) return b.y
    const t = (at - a.x) / span
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * a.y +
      (t3 - 2 * t2 + t) * span * slopes[i - 1]! +
      (-2 * t3 + 3 * t2) * b.y +
      (t3 - t2) * span * slopes[i]!
    )
  }
  return points[points.length - 1]!.y
}

/** 今日费率曲线：注意力轴上的平滑 M，侧栏那张 75×35 的感觉指示器。 */
export function miniCurve(profile: LineShapeSource): TierCurve {
  const x = tierAxis(profile)
  const points = smoothPoints(profile, x, MINI)
  return assemble(x, MINI, points, 'slant', miniTones(profile, x, points))
}

export function curveAriaLabel(profile: LineShapeSource, minute: number): string {
  const windowsText = profile.peakWindows
    .map(([from, to]) => `${clockText(from)} 到 ${clockText(to)}`)
    .join('、')
  const shape = profile.workday ? `高峰 ${windowsText}，其余按空闲价` : '今日非工作日，全天按空闲价'
  return `今日费率曲线（0 点到 24 点）：${shape}；${nowText(profile, minute)}`
}
