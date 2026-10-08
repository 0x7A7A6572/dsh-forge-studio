/**
 * 今日费率形状的几何与文案，纯函数，不碰 React / DOM。
 * 两张形状共用同一条等分轴（1 单位 = 1 分钟）：{@link tierRails} 是弹窗顶部的双轨读数带，
 * {@link tierRing} 是侧栏 75×35 的 12 小时钟盘（一天两圈）。
 */
import { clockText as clockTextOf, toneAtMinute as toneOf } from '../../shape/index.ts'

/** 档位。与宿主判档同口径（见 pricing/tiers.ts），不是曲线高低。 */
export type TierTone = 'peak' | 'valley'

/**
 * 刻意比 `TierDayProfile` 窄：契约的 `TierShapeData` 与宿主的 `TierDayProfile` 都满足它，
 * 于是同一套几何两边都能用。
 */
export interface TierShapeSource {
  readonly workday: boolean
  readonly peakWindows: readonly (readonly [number, number])[]
}

/** 一天的分钟数，同时是等分轴宽度（横坐标就是分钟本身）。 */
export const RAIL_WIDTH = 1440
/** 与 `.tierRailPlot` 的 44px 等高，1 单位 = 1px。 */
export const RAIL_HEIGHT = 44
/** 落差杆用整幅高度，不跟着轨的 y 变。 */
export const RAIL_PLOT_HEIGHT = RAIL_HEIGHT
export const RAIL_PEAK_Y = 8.4
/** 与上轨关于中线对称。 */
export const RAIL_VALLEY_Y = RAIL_HEIGHT - RAIL_PEAK_Y

/** 渐变上的一个停点，只说透明度，不说色值。 */
export interface GradientStop {
  readonly at: number
  readonly alpha: number
}

/** 停点属于上沿（峰色）还是下沿（谷色）。 */
export interface FieldStop extends GradientStop {
  readonly tone: TierTone
}

/** 0.5 处只有一个 alpha 为 0 的停点，色相在那里换手。 */
export const RAIL_FIELD_STOPS: readonly FieldStop[] = [
  { at: 0, tone: 'peak', alpha: 0.22 },
  { at: 0.16, tone: 'peak', alpha: 0.1 },
  { at: 0.34, tone: 'peak', alpha: 0.01 },
  { at: 0.5, tone: 'valley', alpha: 0 },
  { at: 0.66, tone: 'valley', alpha: 0.01 },
  { at: 0.84, tone: 'valley', alpha: 0.09 },
  { at: 1, tone: 'valley', alpha: 0.2 },
]

/** 光场上下外扩量：贴轨线切会留一条硬边。 */
export const RAIL_FIELD_BLEED = 1

/** 亮芯沿一天的浓淡，渐变横跨整天（每段一条会让段的两端自己淡下去）。 */
export const RAIL_CORE_STOPS: Readonly<Record<TierTone, readonly GradientStop[]>> = {
  peak: [
    { at: 0, alpha: 0.34 },
    { at: 0.3, alpha: 0.8 },
    { at: 0.375, alpha: 1 },
    { at: 0.5, alpha: 1 },
    { at: 0.583, alpha: 0.96 },
    { at: 0.75, alpha: 0.86 },
    { at: 1, alpha: 0.3 },
  ],
  valley: [
    { at: 0, alpha: 0.5 },
    { at: 0.3, alpha: 0.82 },
    { at: 0.375, alpha: 0.95 },
    { at: 0.5, alpha: 1 },
    { at: 0.583, alpha: 0.92 },
    { at: 0.75, alpha: 0.84 },
    { at: 1, alpha: 0.46 },
  ],
}

/** 亮芯叠几层；宽度与透明度是 CSS 的事。 */
export const RAIL_CORE_LAYERS = [0, 1] as const

/** 最宽那层只是脚下那圈弥散，读数靠最窄那层。 */
export const RAIL_BEAM_LAYERS = [0, 1, 2] as const

/** mini 时钟的画布，viewBox 与容器 1:1，所以画布坐标就是像素。 */
export const RING_WIDTH = 75
export const RING_HEIGHT = 35
/** 环心靠左，右侧留给「高峰 / 空闲」两个字。 */
export const RING_CENTER_X = 17
export const RING_CENTER_Y = RING_HEIGHT / 2
export const RING_RADIUS = 12.5
/**
 * 环的起点角度（度）：0 = 正上方（钟面 12 点），顺时针增加。
 * 弧与点都从这里出来，改这一个数整圈一起转，两处不可能分叉。
 */
export const RING_START_ANGLE = 0
/** 一圈 = 半天 720 分钟，一天两圈。写成 `RAIL_WIDTH / 2` 让「折成两圈」在源码里可见。 */
export const RING_MINUTES_PER_TURN = RAIL_WIDTH / 2
/** 「现在」那颗珠子的可见半径。盒子尺寸与两层收尾写在 CSS，由 spec 读回来核对。 */
export const RING_DOT_REACH = 3.87
/** 右侧那两个字的位置。 */
export const RING_TEXT_X = 38
export const RING_TEXT_BASELINE = RING_CENTER_Y + 4

/** 轨上的一段实心块，等分轴下就是一段分钟区间。 */
export interface RailBlock {
  /** 左端（含）。 */
  from: number
  /** 右端（不含）。 */
  to: number
  x: number
  width: number
}

/** 双轨：轨的 y 是常量，一天里变的是哪一段压在哪条轨上。 */
export interface TierRails {
  /** 分钟 → 横轴坐标，等分轴下就是分钟本身。 */
  x(minute: number): number
  /** 上轨的块，窗口左闭右开。 */
  peakBlocks: readonly RailBlock[]
  /** 下轨的块。与 `peakBlocks` 一起正好铺满一整天，不重不漏。 */
  valleyBlocks: readonly RailBlock[]
}

/** 一个峰窗在这半天里的那段弧（跨半天的窗会被拆，见 {@link ringArcs}）。 */
export interface RingArc {
  /** 峰窗左端（半天内分钟，0 = 00:00 或 12:00）。 */
  from: number
  /** 右端（半天内分钟，左闭右开）。 */
  to: number
  startAngle: number
  /** 一定大于 `startAngle`，跨度不超过 180°（否则 SVG 的 A 命令画不出来）。 */
  endAngle: number
}

/** 环上的一个点（viewBox 坐标）。 */
export interface RingPoint {
  x: number
  y: number
}

/** 12 小时钟盘（一天两圈）。弧只属于 `minute` 所在的那半天。 */
export interface TierRing {
  /** 分钟 → 角度。每分钟 0.5°，满一圈回到起点。 */
  angle(minute: number): number
  /** 分钟 → 坐标，这就是「现在」那颗点的圆心。 */
  point(minute: number): RingPoint
  /** 这半天的峰弧，已按可画的跨度拆好。 */
  arcs: readonly RingArc[]
  /** 每段弧的 SVG `d`，只有一条 A 命令。 */
  arcPaths: readonly string[]
}

function clampMinute(minute: number): number {
  return Math.min(Math.max(minute, 0), RAIL_WIDTH)
}

/** 峰窗规范形：夹进一天、丢空窗、按起点排序。判档刻意不走这里。 */
function normalizeWindows(profile: TierShapeSource): (readonly [number, number])[] {
  return profile.peakWindows
    .map(([from, to]) => [clampMinute(from), clampMinute(to)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
}

function block(from: number, to: number): RailBlock {
  return { from, to, x: from, width: to - from }
}

function arcPath(arc: RingArc): string {
  const from = polar(arc.startAngle, RING_RADIUS)
  const to = polar(arc.endAngle, RING_RADIUS)
  const large = arc.endAngle - arc.startAngle > 180 ? 1 : 0
  return `M${round(from.x)},${round(from.y)}A${RING_RADIUS},${RING_RADIUS} 0 ${large} 1 ${round(to.x)},${round(to.y)}`
}

/** 极坐标 → 画布坐标。一律舍入 3 位小数：三角函数在正方向上会留 1e-15 的尾巴。 */
function polar(angle: number, radius: number): RingPoint {
  const radians = (angle * Math.PI) / 180
  return {
    x: round(RING_CENTER_X + radius * Math.sin(radians)),
    y: round(RING_CENTER_Y - radius * Math.cos(radians)),
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 半天内分钟 → 角度。不做取模：一圈的终点给 360 而不是 0。
 * 弧的终点必须大于起点，归成 0 会让 SVG 的 A 命令顺着画回去。
 */
function angleInTurn(localMinute: number): number {
  return RING_START_ANGLE + (localMinute / RING_MINUTES_PER_TURN) * 360
}

/** 分钟 → 角度。取模而不是夹住：13:00 要落在 01:00 的位置上。 */
function angleAt(minute: number): number {
  return angleInTurn(clampMinute(minute) % RING_MINUTES_PER_TURN)
}

/** 0 = 上午，1 = 下午。 */
function halfOf(minute: number): number {
  return clampMinute(minute) < RING_MINUTES_PER_TURN ? 0 : 1
}

/**
 * 把峰窗裁进指定半天，换算成半天内分钟。
 * 跨正午 / 午夜的窗在这里被切开，拼起来仍是原来那个窗。
 */
function windowsInHalf(
  windows: readonly (readonly [number, number])[],
  half: number,
): (readonly [number, number])[] {
  const base = half * RING_MINUTES_PER_TURN
  const end = base + RING_MINUTES_PER_TURN
  return windows
    .map(([from, to]) => [Math.max(from, base) - base, Math.min(to, end) - base] as const)
    .filter(([from, to]) => to > from)
}

/** 半天内峰窗 → 可画弧段。跨度超 180° 就拆：半圈占满时起止重合，SVG 画不出来。 */
function ringArcs(windows: readonly (readonly [number, number])[]): RingArc[] {
  const arcs: RingArc[] = []
  for (const [from, to] of windows) {
    const start = angleInTurn(from)
    const end = angleInTurn(to)
    let cursor = start
    while (end - cursor > 180) {
      arcs.push({ from, to, startAngle: cursor, endAngle: cursor + 180 })
      cursor += 180
    }
    arcs.push({ from, to, startAngle: cursor, endAngle: end })
  }
  return arcs
}

/**
 * 双轨：上轨高峰价、下轨空闲价。两串块合起来正好铺满一天，不重不漏。
 * 没有窗口的日子（周末 / 节假日）下轨一条通到底。
 */
export function tierRails(profile: TierShapeSource): TierRails {
  const windows = normalizeWindows(profile)
  const peakBlocks = windows.map(([from, to]) => block(from, to))
  const valleyBlocks: RailBlock[] = []
  let cursor = 0
  for (const [from, to] of windows) {
    if (from > cursor) valleyBlocks.push(block(cursor, from))
    cursor = Math.max(cursor, to)
  }
  if (cursor < RAIL_WIDTH) valleyBlocks.push(block(cursor, RAIL_WIDTH))
  return { x: clampMinute, peakBlocks, valleyBlocks }
}

/** 某一档压在哪条轨上。 */
export function railYOf(tone: TierTone): number {
  return tone === 'peak' ? RAIL_PEAK_Y : RAIL_VALLEY_Y
}

/**
 * 12 小时钟盘（一天两圈）。弧只画 `minute` 所在的那半天：同一条弧对应两个时刻，
 * 只画半天才不会说谎。环上没有刻度，方位由断言钉住。
 */
export function tierRing(profile: TierShapeSource, minute: number): TierRing {
  const arcs = ringArcs(windowsInHalf(normalizeWindows(profile), halfOf(minute)))
  return {
    angle: angleAt,
    point: m => polar(angleAt(m), RING_RADIUS),
    arcs,
    arcPaths: arcs.map(arcPath),
  }
}

/** 此刻档位。判档只有契约里那一份实现，这里只把钱的口径翻成画面口径。 */
export function toneAtMinute(profile: TierShapeSource, minute: number): TierTone {
  return toneOf(profile.peakWindows, minute) === 'peak' ? 'peak' : 'valley'
}

/** 同样只有契约里那一份实现。 */
export function clockText(minute: number): string {
  return clockTextOf(minute)
}

/** 非工作日要在标题里说清楚，否则「全天空闲」看着像没加载。 */
export function curveTitleText(profile: TierShapeSource): string {
  return profile.workday ? '今日费率' : '今日费率（非工作日）'
}

export function nowText(profile: TierShapeSource, minute: number): string {
  const tone = toneAtMinute(profile, minute) === 'peak' ? '高峰' : '空闲'
  return `现在 ${clockText(minute)} · ${tone}`
}

/** 无障碍名：读屏只能从文案里拿到窗口与此刻的档位。 */
export function curveAriaLabel(profile: TierShapeSource, minute: number): string {
  const windowsText = profile.peakWindows
    .map(([from, to]) => `${clockText(from)} 到 ${clockText(to)}`)
    .join('、')
  const shape = profile.workday ? `高峰 ${windowsText}，其余按空闲价` : '今日非工作日，全天按空闲价'
  return `今日费率（0 点到 24 点）：${shape}；${nowText(profile, minute)}`
}
