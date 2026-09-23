/**
 * 今日费率带（M 型峰谷曲线）的几何与文案 —— 纯函数，不碰 React、不碰 DOM。
 *
 * 坐标系 viewBox `0 0 1440 44`：
 * - 横轴 1 个用户单位 = 1 分钟，所以「某时刻」的 x 就是它的当日分钟，不需要换算；
 * - 纵轴只有两级（峰线 / 谷线）：档位本来就是二值的，曲线不该假装存在中间价。
 *
 * 「M 型」= 两个梯形峰（平台 + 两端过渡坡）；两峰之间的谷与首尾的谷自然拼出 M。
 * 颜色**按档位**给（峰暖谷冷），不是按高度 —— 而过渡坡那一段本身就是渐变色带，
 * 所以峰谷切换看起来是一条斜坡而不是一条硬边。
 *
 * 横轴是**规则时区的自然日**（见 pricing/tiers.ts）：费率按北京时间判档，本机同在
 * +08:00 时与本地时钟完全一致；换到别的时区也只是「轴按规则的日」，不会显示错的档位。
 */
import type { TierDayProfile } from '../../pricing/tiers.ts'

/** viewBox 宽度 = 一天的分钟数（横轴 1 单位 = 1 分钟）。 */
export const CURVE_WIDTH = 1440
/** viewBox 高度：与 .tierCurvePlot 的 44px 等高（1 单位 = 1px），指针的 y 才能直接写成 px。 */
export const CURVE_HEIGHT = 44
/** 指针竖线用整幅高度：曲线的 y 会变，竖线不跟着变。 */
export const CURVE_PLOT_HEIGHT = CURVE_HEIGHT
/** 峰线与谷线的 y：上下各留一点边距，指针压在线上不会贴到边框。 */
const PEAK_Y = 9
const VALLEY_Y = 33
/** 过渡坡宽度（分钟）：0 会让峰谷边界像断掉，太长就不像平台了。窗口很窄时按半宽夹住。 */
const RAMP_MINUTES = 20
/** 横轴刻度只画最少的五个整点（0/6/12/18/24 点）。 */
export const AXIS_TICKS: readonly number[] = [0, 360, 720, 1080, 1440]

/** 折线上的一个点（已升序）。 */
export interface CurvePoint {
  minute: number
  /** 画布 y（小 = 高）。 */
  y: number
}

/** 色带上的一站：offset 是 0..1 的横向比例，tone 决定颜色。 */
export interface CurveTone {
  offset: number
  tone: 'peak' | 'valley'
}

export type TierTone = CurveTone['tone']

/** 今日高峰窗口：裁进 0..1440、丢掉空窗、按起点升序。空数组 = 一条平的谷线。 */
function windows(profile: TierDayProfile): (readonly [number, number])[] {
  return profile.peakWindows
    .map(([from, to]) => [Math.max(0, from), Math.min(CURVE_WIDTH, to)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
}

/** 每个窗口的过渡坡宽度：窗口很窄时最多各占半宽，免得两坡重叠成一条竖线。 */
function rampOf(from: number, to: number): number {
  return Math.min(RAMP_MINUTES, Math.floor((to - from) / 2))
}

/**
 * 折点（升序）：谷底 → 上坡 → 平台 → 下坡 → 谷底 …… 最后收在 24:00 的谷底。
 * 坡宽被夹到 0 时会出现同 x 的两个点：那是竖直跳变，保留（画成台阶而不是斜线）。
 */
export function curvePoints(profile: TierDayProfile): CurvePoint[] {
  const points: CurvePoint[] = [{ minute: 0, y: VALLEY_Y }]
  const push = (minute: number, y: number): void => {
    const last = points[points.length - 1]!
    points.push({ minute: Math.min(Math.max(minute, last.minute), CURVE_WIDTH), y })
  }
  for (const [from, to] of windows(profile)) {
    const ramp = rampOf(from, to)
    push(from - ramp, VALLEY_Y)
    push(from, PEAK_Y)
    push(to - ramp, PEAK_Y)
    push(to, VALLEY_Y)
  }
  push(CURVE_WIDTH, VALLEY_Y)
  return points
}

export function linePath(points: readonly CurvePoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.minute},${p.y}`).join('')
}

/** 曲线与下沿围成的面积（淡填充用）：从终点落到底边、沿底边回到起点。 */
export function areaPath(points: readonly CurvePoint[]): string {
  return `${linePath(points)}L${CURVE_WIDTH},${CURVE_HEIGHT}L0,${CURVE_HEIGHT}Z`
}

/**
 * 横向色带：峰段琥珀、谷段蓝，切换发生在过渡坡那一段。
 * 同一个 offset 允许出现两个不同色（坡宽被夹到 0 的窄窗）—— 那就是一条硬边，正是该有的样子。
 */
export function curveTones(profile: TierDayProfile): CurveTone[] {
  const tones: CurveTone[] = [{ offset: 0, tone: 'valley' }]
  const push = (minute: number, tone: TierTone): void => {
    const last = tones[tones.length - 1]!
    const offset = Math.min(Math.max(minute, 0), CURVE_WIDTH) / CURVE_WIDTH
    if (offset < last.offset) return
    if (offset === last.offset && tone === last.tone) return
    tones.push({ offset, tone })
  }
  for (const [from, to] of windows(profile)) {
    const ramp = rampOf(from, to)
    push(from - ramp, 'valley')
    push(from, 'peak')
    push(to - ramp, 'peak')
    push(to, 'valley')
  }
  push(CURVE_WIDTH, 'valley')
  return tones
}

/** minute 处的曲线高度（斜坡段线性插值）：指针永远压在曲线上，不会浮在空中。 */
export function curveYAt(points: readonly CurvePoint[], minute: number): number {
  let prev = points[0]!
  for (const point of points) {
    if (point.minute >= minute) {
      const span = point.minute - prev.minute
      if (span <= 0) return point.y
      return prev.y + (point.y - prev.y) * ((minute - prev.minute) / span)
    }
    prev = point
  }
  return points[points.length - 1]!.y
}

/** 此刻的档位：与宿主 tierAt 同一口径（只看窗口，不看斜坡 —— 斜坡只是画法）。 */
export function toneAtMinute(profile: TierDayProfile, minute: number): TierTone {
  for (const [from, to] of windows(profile)) if (minute >= from && minute < to) return 'peak'
  return 'valley'
}

/** 轴上的分钟 → `HH:MM`。 */
export function clockText(minute: number): string {
  const hour = Math.floor(minute / 60)
  return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

/** 小节标题：非工作日要在标题里就说清楚，否则「全天空闲」看着像数据没加载。 */
export function curveTitleText(profile: TierDayProfile): string {
  return profile.workday ? '今日费率' : '今日费率（非工作日）'
}

/** 右上角那行：「现在 10:32 · 高峰」。 */
export function nowText(profile: TierDayProfile, minute: number): string {
  const tone = toneAtMinute(profile, minute) === 'peak' ? '高峰' : '空闲'
  return `现在 ${clockText(minute)} · ${tone}`
}

/** 无障碍名：整张图是一个位图，读屏只能从文案里拿到窗口与此刻的档位。 */
export function curveAriaLabel(profile: TierDayProfile, minute: number): string {
  const windowsText = profile.peakWindows
    .map(([from, to]) => `${clockText(from)} 到 ${clockText(to)}`)
    .join('、')
  const shape = profile.workday ? `高峰 ${windowsText}，其余按空闲价` : '今日非工作日，全天按空闲价'
  return `今日费率曲线（0 点到 24 点）：${shape}；${nowText(profile, minute)}`
}
