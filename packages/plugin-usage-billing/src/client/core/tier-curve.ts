/**
 * 今日费率带（M 型峰谷曲线）的几何与文案 —— 纯函数，不碰 React、不碰 DOM。
 *
 * 两件事决定这条线怎么画：
 *
 * 1. **横轴是「注意力轴」，不是等分的钟点**。0-7 点、20-24 点没人看，摊在同样的宽度上
 *    只会把真正要紧的峰谷挤到中间，整条线读起来是 `___M____`。所以峰窗两侧各留
 *    FOCUS_PAD_MINUTES 分钟按 1:1 展开，再远的深夜按 NIGHT_DENSITY 压扁 —— 于是变成
 *    `_M_`：两头只剩一点点谷底，中间两座峰几乎铺满。「现在」指针与曲线共用这个映射
 *    （见 tierAxis），几何与读数不可能分叉。
 * 2. **过渡坡是圆肩，不是折角**。每座峰的两侧各用「窗口长度 × TAPER_RATIO」的坡过渡
 *    （约 3 小时 20 分的坡），两端斜率为 0 的 smoothstep 缓动让坡接平台、坡接谷底都
 *    圆过去 —— 整条线读起来是一道平滑的 `m`，而不是梯形的四个角。坡宽按窗口长度走
 *    比例，窄窗口才不会被两道坡夹成一条竖线。渲染的 path 与「指针落在哪」共用同一条
 *    缓动（见 ease），所以指针永远压在线上。
 *
 * 坐标系 viewBox `0 0 CURVE_WIDTH CURVE_HEIGHT`：横轴单位是注意力宽度（由轴映射给出），
 * 不是分钟 —— 分钟只用于刻度标签与判档。纵轴只有两级（峰线 / 谷线）：档位本来就是
 * 二值的，曲线不该假装存在中间价。
 *
 * 颜色**按档位**给（峰暖谷冷），不是按高度 —— 而过渡坡那一段本身就是渐变色带，
 * 所以峰谷切换看起来是一条斜坡而不是一条硬边。
 *
 * 横轴是**规则时区的自然日**（见 pricing/tiers.ts）：费率按北京时间判档，本机同在
 * +08:00 时与本地时钟完全一致；换到别的时区也只是「轴按规则的日」，不会显示错的档位。
 */
import type { TierDayProfile } from '../../pricing/tiers.ts'

/** viewBox 宽度 = 横轴单位总数（不是分钟数；1 单位 = 整条带的 1/1440 宽）。 */
export const CURVE_WIDTH = 1440
/** viewBox 高度：与 .tierCurvePlot 的 44px 等高（1 单位 = 1px），指针的 y 才能直接写成 px。 */
export const CURVE_HEIGHT = 44
/** 指针竖线用整幅高度：曲线的 y 会变，竖线不跟着变。 */
export const CURVE_PLOT_HEIGHT = CURVE_HEIGHT
/** 峰线与谷线的 y：上下各留一点边距，指针压在线上不会贴到边框。 */
const PEAK_Y = 9
const VALLEY_Y = 33
/** 过渡坡宽 = 窗口长度 × 这个比例：坡越长肩越圆，但要给平顶和谷底留位置。 */
const TAPER_RATIO = 0.5
/** 峰窗两侧各留这么久按 1:1 展开（上下班前后也有人看）；更远的深夜才压扁。 */
const FOCUS_PAD_MINUTES = 90
/** 深夜的宽度密度：0.12 → 0-6 点只占 8% 宽，21-24 点不足 5%（等分轴下各是 25%/12.5%）。 */
const NIGHT_DENSITY = 0.12

/** 折线上的一个点（按 x 升序）。 */
export interface CurvePoint {
  /** 规则时区的当日分钟（真实时间；它在轴上的位置看 x）。 */
  minute: number
  /** 横轴坐标（viewBox 单位）。 */
  x: number
  /** 画布 y（小 = 高）。 */
  y: number
}

/** 色带上的一站：offset 是 0..1 的横向比例，tone 决定颜色。 */
export interface CurveTone {
  offset: number
  tone: 'peak' | 'valley'
}

export type TierTone = CurveTone['tone']

/** 今日费率形状画出来的一切：折点、路径、色带，外加「某分钟落在哪」的两个查询。 */
export interface TierCurve {
  /** 分钟 → 横轴坐标（刻度与指针都用它）。 */
  x(minute: number): number
  /** 分钟 → 曲线高度（与渲染出来的 path 同一条缓动，斜坡上也压在线上）。 */
  y(minute: number): number
  points: readonly CurvePoint[]
  /** 曲线路径：平坦段 L，过渡坡 C。 */
  line: string
  /** 曲线与下沿围成的面积路径（淡填充用）。 */
  area: string
  /** 横向色带（峰 / 谷），与折点同源。 */
  tones: readonly CurveTone[]
}

/** 注意力轴的一段：`[from, to)` 的分钟按 density 展开；base 是这段之前累计的宽度。 */
interface AxisSpan {
  from: number
  to: number
  density: number
  base: number
}

function clampMinute(minute: number): number {
  return Math.min(Math.max(minute, 0), CURVE_WIDTH)
}

/** 峰窗各向两侧扩 FOCUS_PAD 并合并重叠 —— 合起来就是「有人看」的那段白天。 */
function focusRanges(profile: TierDayProfile): (readonly [number, number])[] {
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

/** 把 [0, 1440) 切成「白天 1:1 / 深夜压扁」的段，并算好各段起点的累计宽度。 */
function axisSpans(profile: TierDayProfile): { spans: AxisSpan[]; weight: number } {
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

/**
 * 注意力轴：规则时区的当日分钟 → 横轴坐标（对外只经 tierCurve().x 暴露）。
 * 没有窗口（周末 / 节假日）时全天同密度、自然退化成等分轴，刻度仍然等距。
 */
function tierAxis(profile: TierDayProfile): TierCurve['x'] {
  const { spans, weight } = axisSpans(profile)
  return minute => {
    const at = clampMinute(minute)
    for (const span of spans) {
      if (at < span.to) return ((span.base + (at - span.from) * span.density) / weight) * CURVE_WIDTH
    }
    return CURVE_WIDTH
  }
}

/**
 * 每座峰两侧的坡宽（分钟）。比例取自窗口长度，所以宽窗口的肩更圆；
 * 相邻两窗之间那两条**相对**的坡加起来不能超过间距 —— 超了就等比压到刚好吃满间距，
 * 谷底正好落在两窗中点：M 中间那段才是「下到底又上来」，而不是被糊成一个平肩。
 */
function tapersOf(windows: readonly (readonly [number, number])[]): { rise: number[]; fall: number[] } {
  const rise = windows.map(([from, to]) => Math.max(1, Math.round((to - from) * TAPER_RATIO)))
  const fall = [...rise]
  for (let i = 0; i + 1 < windows.length; i++) {
    const gap = windows[i + 1]![0] - windows[i]![1]
    const sum = fall[i]! + rise[i + 1]!
    if (gap <= 0) {
      fall[i] = 0
      rise[i + 1] = 0
      continue
    }
    if (sum > gap) {
      const scale = gap / sum
      fall[i] = Math.floor(fall[i]! * scale)
      rise[i + 1] = Math.floor(rise[i + 1]! * scale)
    }
  }
  return { rise, fall }
}

/**
 * 折点（按 x 升序）：谷底 → 上坡 → 平顶 → 下坡 → 谷底 …… 最后收在 24:00 的谷底。
 * 平顶就是峰窗本身（价在那个区间是平的，曲线不该假装还有起伏），圆肩在窗口两侧。
 * 坡宽被夹到 0 时会出现同 x 的两个点：那是竖直跳变，保留（画成台阶而不是斜线）。
 */
function curvePoints(profile: TierDayProfile, x: TierCurve['x']): CurvePoint[] {
  const windows = profile.peakWindows
    .map(([from, to]) => [clampMinute(from), clampMinute(to)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
  const { rise, fall } = tapersOf(windows)
  const points: CurvePoint[] = []
  const push = (minute: number, y: number): void => {
    const last = points[points.length - 1]
    const at = last === undefined ? clampMinute(minute) : Math.min(Math.max(minute, last.minute), CURVE_WIDTH)
    points.push({ minute: at, x: x(at), y })
  }
  push(0, VALLEY_Y)
  windows.forEach(([from, to], i) => {
    push(from - rise[i]!, VALLEY_Y)
    push(from, PEAK_Y)
    push(to, PEAK_Y)
    push(to + fall[i]!, VALLEY_Y)
  })
  push(CURVE_WIDTH, VALLEY_Y)
  return points
}

/** 写进 d 的坐标只留 3 位小数：手算出来的横轴坐标最容易长的就是没用的浮点尾巴。 */
function coord(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/** smoothstep：两端斜率为 0，所以坡接平台、坡接谷底都不会有折角。 */
function ease(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * 曲线路径：平坦段用 L，过渡坡用 C。
 * 控制点取横向 1/3、2/3 —— 三次 Bézier 的参数式恰好就是 smoothstep（x 与参数同增），
 * 于是「画出来的坡」和 y() 里的缓动是同一条曲线，指针不会浮在线外。
 */
function linePath(points: readonly CurvePoint[]): string {
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
    d += `C${coord(a.x + third)},${a.y} ${coord(b.x - third)},${b.y} ${coord(b.x)},${b.y}`
  }
  return d
}

/** 曲线与下沿围成的面积（淡填充用）：从终点落到底边、沿底边回到起点。 */
function areaPath(points: readonly CurvePoint[]): string {
  return `${linePath(points)}L${CURVE_WIDTH},${CURVE_HEIGHT}L0,${CURVE_HEIGHT}Z`
}

/** 横轴坐标 → 曲线高度：平坦段照抄，斜坡段走 ease（与 linePath 的 C 同一条曲线）。 */
function yAt(points: readonly CurvePoint[], at: number): number {
  let prev = points[0]!
  for (const point of points) {
    if (point.x < at) {
      prev = point
      continue
    }
    const span = point.x - prev.x
    if (span <= 0) return point.y
    return prev.y + (point.y - prev.y) * ease((at - prev.x) / span)
  }
  return points[points.length - 1]!.y
}

/** 今日费率形状 —— popup 那条曲线要用的一切都从这里出，别处不要再算一遍几何。 */
export function tierCurve(profile: TierDayProfile): TierCurve {
  const x = tierAxis(profile)
  const points = curvePoints(profile, x)
  return {
    x,
    y: minute => yAt(points, x(minute)),
    points,
    line: linePath(points),
    area: areaPath(points),
    // 色带与折点同源：折点的 y 就是它那一刻的档，偏移用同一个 x —— 不会出现色带切在坡外。
    tones: points.map(point => ({
      offset: point.x / CURVE_WIDTH,
      tone: point.y === PEAK_Y ? ('peak' as const) : ('valley' as const),
    })),
  }
}

/** 此刻的档位：与宿主 tierAt 同一口径（只看窗口，不看斜坡 —— 斜坡只是画法）。 */
export function toneAtMinute(profile: TierDayProfile, minute: number): TierTone {
  for (const [from, to] of profile.peakWindows) if (minute >= from && minute < to) return 'peak'
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
