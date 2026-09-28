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
 *
 * 这个模块给**两张形状**，共用同一条注意力轴与同一套路径构造（linePath / areaPath / yAt）：
 * - {@link tierCurve} —— 弹窗顶部那条**读数**带：峰窗画成平顶（价在那个区间确实是平的），
 *   窗口两侧走圆肩过渡坡。它要回答「今天几点贵」。
 * - {@link miniCurve} —— 侧栏那 75×35 的**感觉**指示器：峰窗不做平顶，只在窗口中点取一次顶；
 *   纵向骨架照抄一条 6 点的手绘路线（起点 22 / 小峰 12 / 波谷 20 / 大峰 4 / 下行肩 16 / 夜角 26），
 *   起点落在 00:00、终点落在 24:00。整条线是一道平滑的 M，一段直线都没有。它要回答「此刻像不像在峰上」。
 *
 * 两者刻意不同形：把 4 小时的平价窗口画成一条波形，等于让位置读数撒了谎；反过来把
 * 24 个折点的精确形状塞进 75px，圆肩会被压成折角、反倒什么都读不出来。各自服务一个用途。
 */
import type { TierDayProfile } from '../../pricing/tiers.ts'

/** viewBox 宽度 = 横轴单位总数（不是分钟数；1 单位 = 整条带的 1/1440 宽）。 */
export const CURVE_WIDTH = 1440
/** viewBox 高度：与 .tierCurvePlot 的 44px 等高（1 单位 = 1px），指针的 y 才能直接写成 px。 */
export const CURVE_HEIGHT = 44
/** 指针竖线用整幅高度：曲线的 y 会变，竖线不跟着变。 */
export const CURVE_PLOT_HEIGHT = CURVE_HEIGHT
/**
 * mini 的 viewBox 高度。大图那 44 单位里有 9（峰上）+ 11（谷下）= 20 单位是边距 ——
 * 在 44px 高时那是留白，照搬到 35px 的 mini 上就变成 43% 的空白（曲线只占第 7-26 行）。
 * 所以 mini 自己一套纵向口径：上下各留 4 单位给描边，中间 22 单位是行程。
 */
export const MINI_CURVE_HEIGHT = 30

/** 一条曲线的纵向口径：viewBox 高度 + 峰线 / 谷线的 y。 */
interface CurveGeometry {
  /** viewBox 高度，也是面积路径的下沿。 */
  height: number
  /** 峰线（小 = 高）。 */
  peakY: number
  /** 谷线。 */
  valleyY: number
}

/** 大图：上下各留一点边距，指针压在线上不会贴到边框。 */
const BIG: CurveGeometry = { height: CURVE_HEIGHT, peakY: 9, valleyY: 33 }
/** mini：边距收窄到 4 单位 —— 同样 35px 高，行程从 24/44 变成 22/30。peakY 也是全天最高点。 */
const MINI: CurveGeometry = { height: MINI_CURVE_HEIGHT, peakY: 4, valleyY: 26 }
/**
 * mini 的纵向骨架 = 一条 6 点的手绘路线，从下往上依次
 * **终点（夜角 26）→ 起点（22）→ 波谷（20）→ 小峰（12）→ 大峰（4）**。
 *
 * 这几个数不是拍的：把那条参考路线（起点 3 / 小峰 5.5 / 波谷 3.5 / 大峰 7.5 / 下行 4.5 /
 * 终点 2）按量程映射到 4..26 就得到它们 —— 有意思的是其中四个本来就落在这份文件已有的常量上。
 * 于是「上午小峰、下午大峰」靠**高度**分大小（小峰只有大峰的 62.5%），不再靠宽度。
 * 参考里那个「下行 4.5」在这份骨架里没有对应物：22 单位的下坡只摊到 22.5px，中间插一个锚点
 * 必然在下坡中段顿出一个曲率跳变（见 smoothPoints），所以那段一口气滑到底。
 */
const MINI_SUB_PEAK_Y = 12
/**
 * mini 的窗间波谷 = 20。它比起点（22）**浅**：一天的底不该是一条水平线 —— 波谷若也落到夜线上，
 * 两座峰之间就掉出一条平底，M 的中间会塌掉。
 */
const MINI_SADDLE_Y = 20
/**
 * mini 的起点 = **00:00 那一格的高度**：参考那条路线的第一个点(0.5, 3) 高于它的终点(2)，
 * 也就是参考的线本来就是从半山腰起笔的 —— 这里照抄，(0, 22) 就是整条路的起笔点。
 * 它下面只剩 24:00 那个夜角（26），所以全天最低点不在左边，这是有意为之。
 */
const MINI_RAMP_Y = 22
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
function curvePoints(profile: TierDayProfile, x: TierCurve['x'], geom: CurveGeometry): CurvePoint[] {
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
  push(0, geom.valleyY)
  windows.forEach(([from, to], i) => {
    push(from - rise[i]!, geom.valleyY)
    push(from, geom.peakY)
    push(to, geom.peakY)
    push(to + fall[i]!, geom.valleyY)
  })
  push(CURVE_WIDTH, geom.valleyY)
  return points
}

/**
 * 第 index 座峰（0 起）顶到哪 —— 参考路线里小峰只有大峰 62.5% 的高，所以这里也照抄：
 * 单窗的日子它就是大峰；多窗时第一个是小峰、最后一个是高峰，中间的按序插值。
 */
function miniPeakY(index: number, count: number, geom: CurveGeometry): number {
  if (count < 2) return geom.peakY
  const t = index / (count - 1)
  return MINI_SUB_PEAK_Y + (geom.peakY - MINI_SUB_PEAK_Y) * t
}

/**
 * mini 的折点：**完全平滑的 M** —— 峰窗不做平顶，只在窗口中点取一次顶；纵向骨架见那一组常量。
 *
 * 大图那条会把峰窗画成一段平顶（8:00-12:00 一直是最高），因为它要如实反映「这四小时价一样」。
 * 75×35 里这么画读出来是两个梯形：位置读数没人看得见，反倒把「此刻在不在峰上」埋掉了。
 * 所以这里每个峰窗只留**一个**顶点，落在窗口中点；整条线读出来是一道路线：
 *
 *   起点(22)@00:00 → 小峰(12) → 波谷(20) → 大峰(4) → 夜角(26)@24:00
 *
 * **起点在 00:00、不在第一个峰的左脚**：参考那条路线的第一个点(0.5, 3) 本来就**不是**它的最低点
 * （终点 2 才是），也就是说参考的线是从半山腰起笔的。所以这里也照抄：0 点直接落在 MINI_RAMP_Y，
 * 一路爬到 10:30 的小峰 —— 线不从画布左下角爬起来，全天最低点只剩 24:00 那一格。
 * 例外：第一个峰窗从 0 点就开始（0 点本身在峰上）时不补这个起点，否则会在峰前挖出一个假谷。
 *
 * **两个峰不一样高**：参考路线里小峰只有大峰 62.5% 的高，所以第一个峰窗取 MINI_SUB_PEAK_Y、
 * 最后一个取 geom.peakY，中间还有峰就线性插值（见 miniPeakY）。单窗的日子只有大峰。
 *
 * **下坡不插锚点**：大峰到 24:00 一口气滑到底，22 单位的高差全交给一段三次曲线。
 * 中间插锚点（曾经插过大峰到 24:00 的像素中点）看着更"有结构"，实际上必然在下坡中段顿出一个
 * 曲率跳变：斜率连续、**曲率不连续**。原因是峰顶切线为 0，坡的中段又要在 11px 里走出 1.24 的
 * 平均斜率，斜率只能先冲到 1.66 再被谐波平均拉回锚点上的 1.13 —— 细线读出来就是个软拐角。
 * 实测（宽 75px、按 x 均匀取 30 点量二阶差分）：插锚点 0.0217、不插 0.0021，差十倍。
 *
 * 切线由 slopesOf 的单调三次样条给出，所以**只有真正的极值点才是水平的**：两个峰与中间的波谷
 * 顶点圆；两个端点用单侧斜率斜着切进 / 切出画布，不收平（见 EndTangent 的 `slant`）。
 * 相邻锚点的高度两两不等，所以**一段 L 都不会产生** —— 整条路全是 C。
 * 唯一的例外是没有峰窗的日子（周末）：那天没有形状可画，整条压在夜线上，是一条诚实的平线。
 */
function smoothPoints(profile: TierDayProfile, x: TierCurve['x'], geom: CurveGeometry): CurvePoint[] {
  const windows = profile.peakWindows
    .map(([from, to]) => [clampMinute(from), clampMinute(to)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
  const points: CurvePoint[] = []
  const push = (minute: number, y: number): void => {
    const last = points[points.length - 1]
    const at = last === undefined ? clampMinute(minute) : Math.min(Math.max(minute, last.minute), CURVE_WIDTH)
    // 同一个 x 上只允许一个点，后写的那个说了算。注意 `minute` 被夹到不小于上一个点，
    // 所以点列一定单调不减；撞上时通常两者同高（两个峰窗挨得近、肩顶到波谷上就是这种），
    // 只有峰窗**互相重叠**这种退化配置才会撞出不同高 —— 那时以写在后面的锚点为准。
    if (last !== undefined && at === last.minute) {
      last.y = y
      return
    }
    points.push({ minute: at, x: x(at), y })
  }
  // 起点就落在 0 点：参考的线本来就是从半山腰起笔的（它的第一个点高于终点），这里照抄 ——
  // 不从画布左下角爬起来，也不落成一段平底。周末没有峰窗（全天同价）时才压回夜角。
  const first = windows[0]
  const startsOnPeak = first !== undefined && first[0] === 0
  push(0, startsOnPeak || first === undefined ? geom.valleyY : MINI_RAMP_Y)
  windows.forEach(([start, end], i) => {
    const mid = (start + end) / 2
    push(mid, miniPeakY(i, windows.length, geom))
    const next = windows[i + 1]
    // 波谷落在两窗正中间：两窗的距离和各自肩宽无关，所以这个中点同时是**轴**上的中点，画出来不会偏。
    if (next !== undefined) push((end + next[0]) / 2, MINI_SADDLE_Y)
  })
  push(CURVE_WIDTH, geom.valleyY)
  return points
}

/**
 * 端点（0 点 / 24 点）的切线口径。
 * - `flat`：大图用 —— 读数图的边就是画布边，收平了才不显得被切断；
 * - `slant`：mini 用 —— 取单侧斜率斜着切进 / 切出，两端才不会鼓出平头（见 slopesOf）。
 */
type EndTangent = 'flat' | 'slant'

/**
 * 把折点装配成对外的曲线对象 —— 两张形状只差口径、折点与**色带切点**，其余完全同源。
 *
 * 色带切点单独传进来，因为「形状的折点」和「颜色的边界」不是一回事：大图两者恰好重合，
 * mini 则要给窗口端点补切点（见 miniTones）。
 */
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
    // 指针的高度与画出来的 path 是同一条三次曲线，斜坡上也压在线上。
    y: minute => yAt(points, slopes, x(minute)),
    points,
    line: linePath(points, slopes),
    area: areaPath(points, slopes, geom),
    tones,
  }
}

/**
 * 大图的色带切点 = 折点本身：它只有两个高度（峰线 / 谷线），而折点又正好落在窗口端点上，
 * 所以「按 y 等于峰线判色」和「按档位判色」在这里是同一件事。
 */
function bigTones(points: CurvePoint[]): CurveTone[] {
  return points.map(point => ({
    offset: point.x / CURVE_WIDTH,
    tone: point.y === BIG.peakY ? 'peak' : 'valley',
  }))
}

/**
 * mini 的色带切点 = **折点 ∪ 每个峰窗的两端**，两样都缺不得：
 * - 折点决定琥珀包鼓在哪（峰上）。少了它色带就成了一条按窗口分段的热力条，跟曲线的鼓包对不上。
 * - 窗口端点决定琥珀色的边界。少了它最后一个峰之后就没有切点，琥珀会一路糊到 24:00 ——
 *   大峰到 24:00 合并成一段（见 smoothPoints）之后，再没有折点能替它守这条边界。
 */
function miniTones(profile: TierDayProfile, x: TierCurve['x'], points: CurvePoint[]): CurveTone[] {
  const minutes = new Set(points.map(point => point.minute))
  for (const [from, to] of profile.peakWindows) {
    minutes.add(clampMinute(from))
    minutes.add(clampMinute(to))
  }
  return [...minutes]
    .sort((a, b) => a - b)
    .map(minute => ({ offset: x(minute) / CURVE_WIDTH, tone: toneAtMinute(profile, minute) }))
}

/** 写进 d 的坐标只留 3 位小数：手算出来的横轴坐标最容易长的就是没用的浮点尾巴。 */
function coord(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * 每个折点上的切线斜率（dy/dx）—— Fritsch–Carlson 那套单调三次样条（MATLAB `pchip`）。
 *
 * 在这之前每一段都是「两端切线水平的三次贝塞尔」，等于把**每一个**折点都当成极值点。
 * 峰和鞍因此是圆的，代价是落脚点（09:00 / 20:00）也被压出一个水平停顿，两个端点更是收成
 * 平头 —— 0:00-07:00 只占 4.7px 却几乎不抬升。这里只让**真正的**极值点斜率为 0：
 * - 单调段给真实斜率，取加权调和平均（权重按两侧区间宽）—— 保单调，且不过冲：
 *   线不会拱到峰上面去，也不会塌到谷下面去；
 * - 一侧是平坦段、或两侧斜率反号 → 此处就是极值点（峰 / 鞍 / 平顶平底的两端）→ 水平切线；
 * - 端点取单侧割线，斜着切进 / 切出画布（见 EndTangent）。
 *
 * 大图的折点全部落在「平坦段」与「极值点」两类里，斜率因此全是 0，Hermite 退化成 smoothstep
 * —— 它的 d 与换成本函数之前**逐字节相同**。
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
      // 端点取单侧割线（按弦的斜率起手），**不取 0** —— 一取 0 线就贴着画布边收平，
      // 两端鼓出平头，那正是要修的东西。pchip 的三点式在这里会被限幅砍成 0
      // （角落→07:30 那段比后面那段平太多，三点式外推出的斜率反号），所以不用它。
      return (i === 0 ? secant[0] : secant[count - 2]) ?? 0
    }
    const left = secant[i - 1]!
    const right = secant[i]!
    // 一侧平、或两侧反号 → 极值点（峰、鞍、平顶平底的两端），切线水平
    if (left === 0 || right === 0 || left * right < 0) return 0
    // Fritsch–Butland 加权调和平均：区间越宽的一侧越说了算
    const hPrev = points[i]!.x - points[i - 1]!.x
    const hNext = points[i + 1]!.x - points[i]!.x
    const wPrev = 2 * hNext + hPrev
    const wNext = hNext + 2 * hPrev
    return (wPrev + wNext) / (wPrev / left + wNext / right)
  })
  // 单调限幅（Fritsch–Carlson）：一条区间两端的切线都得落在单调域里，否则三次段会过冲
  // —— 线会拱到峰上面去、或塌到谷下面去。调和平均本身已在域内，这里兜的是端点那两条割线。
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

/**
 * 曲线路径：平坦段用 L，过渡坡用 C。
 * 控制点取横向 1/3、2/3，纵向偏移 = 该端斜率 × 区间宽 / 3 —— 这正是三次 Hermite 的 Bézier 形式，
 * 所以「画出来的坡」和 y() 里的求值是同一条曲线，指针不会浮在线外。
 * 斜率为 0 时控制点落在端点高度上，与老写法逐字节一致。
 */
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

/** 曲线与下沿围成的面积（淡填充用）：从终点落到底边、沿底边回到起点。 */
function areaPath(points: readonly CurvePoint[], slopes: readonly number[], geom: CurveGeometry): string {
  return `${linePath(points, slopes)}L${CURVE_WIDTH},${geom.height}L0,${geom.height}Z`
}

/** 横轴坐标 → 曲线高度：平坦段照抄，斜坡段走与 linePath 同一条三次 Hermite。 */
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
    // 三次 Hermite 基：h00 p0 + h10 m0 + h01 p1 + h11 m1（斜率为 0 时退化成 smoothstep）
    return (
      (2 * t3 - 3 * t2 + 1) * a.y +
      (t3 - 2 * t2 + t) * span * slopes[i - 1]! +
      (-2 * t3 + 3 * t2) * b.y +
      (t3 - t2) * span * slopes[i]!
    )
  }
  return points[points.length - 1]!.y
}

/** 今日费率形状 —— popup 那条**读数**曲线要用的一切都从这里出，别处不要再算一遍几何。 */
export function tierCurve(profile: TierDayProfile): TierCurve {
  const x = tierAxis(profile)
  const points = curvePoints(profile, x, BIG)
  return assemble(x, BIG, points, 'flat', bigTones(points))
}

/**
 * mini 今日费率形状 —— 侧栏那 75×35 的**感觉**指示器。
 *
 * 与 tierCurve 共用注意力轴与路径构造，只换三件事：折点改成完全平滑的 M（见 smoothPoints）、
 * 纵向骨架换成那条 5 点路线（见 MINI_SUB_PEAK_Y 那一组）、色带切点补上窗口端点（见 miniTones）。
 * 所以坐标要按 MINI_CURVE_HEIGHT 换算，不能拿 CURVE_HEIGHT 去除。
 */
export function miniCurve(profile: TierDayProfile): TierCurve {
  const x = tierAxis(profile)
  const points = smoothPoints(profile, x, MINI)
  return assemble(x, MINI, points, 'slant', miniTones(profile, x, points))
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
