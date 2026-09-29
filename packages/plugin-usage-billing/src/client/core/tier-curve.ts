/**
 * 今日费率形状的几何与文案 —— 纯函数，不碰 React、不碰 DOM。
 *
 * 两张形状，共用**同一条等分时间轴**（0..1440 分钟按 1:1 摊开，1 单位 = 1 分钟）：
 *
 * - {@link tierRails} —— 弹窗顶部那条**读数**带：两根轨道。上轨 = 高峰价、下轨 = 空闲价，
 *   24 小时里哪一段亮在哪条轨上就是哪一档，「半价」是两轨之间那片**落差光场**的浓淡
 *   （材质见下面的「落差光场 + 档位光晕」一节）。它要回答「今天几点贵」，以及「此刻离另一档有多远」。
 * - {@link tierRing} —— 侧栏那 75×35 的**时钟**：一圈 12 小时、**一天转两圈**，
 *   12:00 与 00:00 都在正上方、顺时针一周；峰窗是琥珀弧，环上那一点就是此刻。
 *   它要回答「此刻像不像在峰上」。
 *
 * ## 横轴为什么从「注意力轴」换成等分轴
 *
 * 旧的大图是一条 M 型曲线，横轴白天 1:1、深夜 ×0.12 —— 不压扁的话两座峰会被 9 小时的夜里
 * 摊薄成 `___M____`，形状就读不出来了。双轨只有两个高度，压不压扁都读得出来；
 * 而等分轴换来的是**位置 = 时刻**：轨上的横坐标就是分钟本身，环上的角度是同一把尺子
 * **折成两圈**（一圈 {@link RING_MINUTES_PER_TURN} 分钟），两处读的是同一个时刻。
 * 代价是 00:00-09:00 那条蓝块会占掉 37.5% 的宽度 —— 那确实是「全天空闲」，不算说谎。
 *
 * ## mini 为什么是一天两圈的 12 小时盘
 *
 * 机械钟是 12 小时一圈、一天两圈，人读角度的直觉就是照着它长的：24 小时一天一圈时，
 * 11:59 的点落在**正下方**，按钟面读成了「5:59」—— 方向感反而是错的。所以盘改回 12 小时。
 *
 * 但 12 小时盘要先解决一个矛盾：**同一条弧对应两个时刻**。高峰 09:00-12:00 与空闲
 * 21:00-24:00 落在同一段弧上（一天 720 个半小时格里，有 420 格的两个时刻档位相反，
 * 例：02:00 空闲 / 14:00 高峰）。若一圈只画一套弧，那 420 格里总有一半在说谎。
 *
 * 解法不是退回 24 小时，而是**只画此刻所在的那半天**：{@link tierRing} 拿到的弧是
 * 「当前这 12 小时」的峰窗（横跨正午/午夜的窗按半天切开）。于是任何时刻圈上只有一套弧，
 * 点与弧永远出自同一个半天，读数不可能错。12:00 与 00:00 翻页时弧会整片换位 ——
 * 那是诚实的「现在是下午了」，不是跳变。代价：**看不到另一半天的峰**（那件事归大图）。
 *
 * ## 环上为什么没有刻度
 *
 * 曾经铺过 24 格时刻刻度（每 6 小时一根长的），理由是「光秃的圆环无法验证对错」。
 * 现在刻度全去掉了：环做成一根粗细一致的普通粗环，起点由 {@link RING_START_ANGLE} 钉在
 * **正上方（钟面的 12 点）**。可核对的那条口径并没有丢 —— 它从「用眼睛数刻度」挪到了断言里：
 * 00:00 与 12:00 都在正上方、06:00 与 18:00 都在正下方、03:00 与 15:00 正右、09:00 与 21:00
 * 正左，误差精确为 0；以及那条最要紧的「点落在琥珀弧内 ⟺ 该分钟判为高峰」在一天两圈下依然
 * 每分钟成立（见 scripts/billing-tier-curve.spec.ts）。
 * 环上少一层噪声，读数只剩「点压不压在琥珀段上」这一件事。
 */
import { clockText as clockTextOf, toneAtMinute as toneOf } from '../../shape/index.ts'

/** 档位。与宿主判档同口径（见 pricing/tiers.ts），不是「曲线高低」。 */
export type TierTone = 'peak' | 'valley'

/**
 * 形状侧的最小数据来源。
 *
 * 刻意比 `TierDayProfile` 窄：契约里的 `TierShapeData` 与宿主内部的 `TierDayProfile`
 * **都满足它**，所以同一套几何既能给 popup 用（拿完整 profile），也能给形状用
 * （只拿契约给的那几个字段）。`offPeakRatio` / `utcOffsetMinutes` 不在里面 ——
 * 前者是旧 M 型曲线的谷底高度，后者只用于把本机时钟换算成规则时区，两者都不是几何。
 */
export interface TierShapeSource {
  readonly workday: boolean
  readonly peakWindows: readonly (readonly [number, number])[]
}

/**
 * 双轨的 viewBox 宽度 = 一天的分钟数。
 * **等分轴**，所以这个值同时是「一天有多少个单位」和「一天有多少分钟」——
 * 横坐标就是时刻本身，不需要任何映射表。
 */
export const RAIL_WIDTH = 1440
/** 双轨的 viewBox 高度：与 .tierRailPlot 的 44px 等高（1 单位 = 1px），「现在」点的 top 才能直接写 px。 */
export const RAIL_HEIGHT = 44
/** 「现在」那根落差杆用整幅高度：轨的 y 会变，杆不跟着变。 */
export const RAIL_PLOT_HEIGHT = RAIL_HEIGHT
/** 上轨（高峰价）的 y。上下各留 8.4 单位，实心块（7px 粗）和「现在」点都不会贴到画布边。 */
export const RAIL_PEAK_Y = 8.4
/** 下轨（空闲价）的 y —— 与上轨关于中线对称。 */
export const RAIL_VALLEY_Y = RAIL_HEIGHT - RAIL_PEAK_Y

/* ---------- 材质：落差光场 + 发丝亮芯 ---------- */
/*
 * 两根轨的**几何**上面就写完了；这一节决定它们**长什么样**。
 *
 * 起因：两条实心圆头描边读起来和任何进度条都是同一种东西 —— 圆角、实色、边缘一刀切。
 * 换法是把「一条线」拆成两件、并且让**落差本身有面积**：
 * - {@link RAIL_FIELD_STOPS} **落差光场**：两轨之间那片**竖向**渐变（上沿琥珀 → 中间透明 → 下沿蓝），
 *   全天常驻。它画的是「半价」这件事本身 —— 两轨之间的距离从此不是一个空档，而是一片有颜色的东西，
 *   所以「另一档在哪」在凌晨也看得见。这一件是主角。
 * - {@link RAIL_CORE_STOPS} **发丝亮芯**：属于哪一档，哪一段就在那条轨上亮起一根细芯，
 *   外面套一层低透明弥散（{@link RAIL_CORE_LAYERS} 层，宽度与透明度在 CSS 的
 *   .tierRailCore[data-layer]）。芯自己沿一天有浓淡（{@link RAIL_CORE_STOPS}），
 *   所以它不是一根等亮的填充条，而是「光在纤维里，正午更亮一点」。
 *
 * 两个表都只写 offset 与 alpha：**色相是主题的事**（--ub-peak / --ub-valley），
 * 明暗与透明度是形状的事 —— 换主题不该动这里一行。
 *
 * 一段走过的弯路记在这里，免得后人再走：先做过「四层同心描边叠出的柔光」（没有硬边）。
 * 画面上它比实心条更糊：段与段之间的边界要靠亮度差读，而四层叠加把没亮的轨也抬到 0.37、
 * 亮的那段才 0.76 —— 只剩 2× 出头，边界反而比实心条更难认。光场才是这个设计的主角，
 * 亮芯只该是「一根亮线」，不该是一团雾。
 */

/** 一条渐变上的一个停点。只描述「多透明的什么色」，不说具体色值。 */
export interface GradientStop {
  /** 渐变上的位置（0..1）。 */
  readonly at: number
  /** 该处的透明度（0..1）。 */
  readonly alpha: number
}

/** 光场的停点还得说自己是上沿（峰色）还是下沿（谷色）那一侧。 */
export interface FieldStop extends GradientStop {
  readonly tone: TierTone
}

/**
 * 落差光场：两轨之间那片竖向渐变 —— 上沿琥珀、中间透明、下沿蓝。
 *
 * 0.5 处只有一个 alpha 为 0 的停点，于是**色相就在那里换手**：上半天是峰色、下半天是谷色。
 * 靠一个停点而不是两个同 offset 的停点，是因为中间那段 alpha 已经低到看不见，
 * 让浏览器去插值比手写一条硬缝更稳（也少一条「0.5 到底属于哪一档」的歧义）。
 */
export const RAIL_FIELD_STOPS: readonly FieldStop[] = [
  { at: 0, tone: 'peak', alpha: 0.22 },
  { at: 0.16, tone: 'peak', alpha: 0.1 },
  { at: 0.34, tone: 'peak', alpha: 0.01 },
  { at: 0.5, tone: 'valley', alpha: 0 },
  { at: 0.66, tone: 'valley', alpha: 0.01 },
  { at: 0.84, tone: 'valley', alpha: 0.09 },
  { at: 1, tone: 'valley', alpha: 0.2 },
]

/** 光场上下各外扩多少：贴着轨线切会留下一条硬边，外扩 1 单位就够化开。 */
export const RAIL_FIELD_BLEED = 1

/**
 * 亮芯沿**一天**的浓淡（按档位各一份）：正午最亮（1），两头（凌晨 / 深夜）压到 0.3–0.5。
 *
 * 渐变横跨整天而不是每段一条，是**故意的**：每段一条必然让每段的两端自己淡下去，
 * 段与段的边界就跟着糊了。全天一条则相反 —— 同一时刻只有一条轨上亮着，
 * 边界是「亮 / 不亮」而不是「浓 / 淡」，一眼能认。芯的浓淡是装饰，边界才是读数。
 */
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

/** 亮芯叠几层：一层弥散 + 一根芯。这里只说**有几层**，宽度与透明度是 CSS 的事。 */
export const RAIL_CORE_LAYERS = [0, 1] as const

/** 「现在」那根光柱叠几层：最宽的一层只是它脚下那圈弥散，读数全靠最窄那层。 */
export const RAIL_BEAM_LAYERS = [0, 1, 2] as const

/**
 * mini 时钟的画布：**死尺寸 75×35 CSS px**，viewBox 与容器 1:1。
 * 与旧版最大的不同在这里 —— 曲线那版要把 30 单位的 viewBox 纵向拉到 35px，于是指针的 y
 * 只能用百分比；环是 1:1 的，画布坐标**就是**像素，所以那颗珠子叠 HTML 层时
 * `left/top` 直接写画布坐标即可，不存在「百分比与 px 对不上」这种坑。
 */
export const RING_WIDTH = 75
export const RING_HEIGHT = 35
/** 环心靠左，右侧 75 - 17 - 12.5 = 45.5 单位留给「高峰 / 空闲」两个字。 */
export const RING_CENTER_X = 17
export const RING_CENTER_Y = RING_HEIGHT / 2
/** 环半径。上下留 17.5 - 12.5 = 5 单位，环宽 5 → 外沿 15，上下各还有 2.5。 */
export const RING_RADIUS = 12.5
/**
 * 环的起点角度（度）：**0 = 正上方（钟面的 12 点）**，顺时针增加。
 *
 * 单独拎成一个常数，是因为「12:00 / 00:00 对上钟面的 12 点」是一条口径而不是一处笔误：
 * 弧与点都从 {@link angleAt} 出来，改这一个数整圈一起转，两处不可能分叉。
 * 现取值 0（正上方）—— 这就是用户要的那个方位，别再让任何一处自己加偏移。
 */
export const RING_START_ANGLE = 0
/**
 * 环的一圈 = **半天 720 分钟** —— 一天两圈，所以 12:00 与 00:00 都落在正上方，
 * 读数与机械钟一致（见文件头「mini 为什么是一天两圈的 12 小时盘」）。
 *
 * 写成 {@link RAIL_WIDTH} / 2 而不是 720，是为了让「一圈是那条等分轴的一半」这件事
 * 在源码里就能看见：大图的横轴是整天，环把它折成两圈。
 */
export const RING_MINUTES_PER_TURN = RAIL_WIDTH / 2
/**
 * 「现在」那颗珠子的**可见半径**：外面那圈晕收干净的地方（半盒 4.5 × 86%）。
 *
 * 旧版是「实心块 + 一圈底色描边」，那圈描边半径 3.7 比环的半宽 2.5 还大 ——
 * 切向会把环**挖断**（实测 310°–342° 两处断口），点在环上看着像开了个洞，
 * 而实心块半径只有 2.9、比环还窄，连「珠子」的形都没有：既没有形，又留下两道口子。
 * 现在是一颗粒子：两层同色径向渐变叠出实心核 + 一圈晕，不挖环，靠**比环胖**
 * （4.5 − 2.5 = 1.37）读出来，与大图那颗点是同一个语法。
 *
 * 盒子尺寸与两层的收尾百分比写在 CSS 里（.miniRingDot），
 * scripts/billing-tier-curve.spec.ts 会把那条规则读回来核对 —— 两处不许漂。
 */
export const RING_DOT_REACH = 3.87
/** 右侧那两个字：位置与字号。两个字宽约 22 单位，38 + 22 = 60 < 75。 */
export const RING_TEXT_X = 38
export const RING_TEXT_BASELINE = RING_CENTER_Y + 4

/** 轨上的一段实心块。等分轴下它就是一段分钟区间。 */
export interface RailBlock {
  /** 左端（含）。 */
  from: number
  /** 右端（不含）。 */
  to: number
  /** 左端在 viewBox 里的横坐标。 */
  x: number
  /** 块宽（viewBox 单位）—— 等分轴下与 `to - from` 同值。 */
  width: number
}

/** 弹窗那条双轨：两根轨的 y 是常量，一天里变的是「哪一段压在哪条轨上」。 */
export interface TierRails {
  /** 分钟 → 横轴坐标。等分轴，所以它就是分钟本身；仍留成函数，免得调用方到处自己换算。 */
  x(minute: number): number
  /** 高峰窗 —— 上轨的琥珀块。窗口左闭右开，与判档同一口径。 */
  peakBlocks: readonly RailBlock[]
  /** 非高峰时段 —— 下轨的蓝块。与 peakBlocks 一起**正好铺满**一整天，不重不漏。 */
  valleyBlocks: readonly RailBlock[]
}

/** 环上的一段弧（一个峰窗在**这半天**里的那一段；整圈或跨半天的窗会被拆，见 ringArcs）。 */
export interface RingArc {
  /** 这段弧对着的峰窗左端（**半天内**的分钟：0 = 半天起点，也就是 00:00 或 12:00）。 */
  from: number
  /** 右端（半天内分钟，左闭右开）。 */
  to: number
  /** 起始角度（度）：{@link RING_START_ANGLE} + 半天内时刻在一圈里的占比。 */
  startAngle: number
  /** 结束角度（度）。一定大于 startAngle，且跨度不超过 180°（否则 SVG 的 A 命令画不出来）。 */
  endAngle: number
}

/** 环上的一个点（viewBox 坐标）。 */
export interface RingPoint {
  x: number
  y: number
}

/** 侧栏那个 **12 小时钟盘**（一天两圈）。弧只属于拿到的那一刻所在的那半天。 */
export interface TierRing {
  /** 分钟 → 环上的角度（度）。一天两圈：每分钟 0.5°，满一圈回到 {@link RING_START_ANGLE}。 */
  angle(minute: number): number
  /** 分钟 → 环上的坐标。**这就是「现在」那颗点的圆心**，也保证点一定压在环上。 */
  point(minute: number): RingPoint
  /** 这半天的峰弧，已按可画的跨度拆好。 */
  arcs: readonly RingArc[]
  /** 每段弧的 SVG `d`（只有一条 A 命令）。 */
  arcPaths: readonly string[]
}

function clampMinute(minute: number): number {
  return Math.min(Math.max(minute, 0), RAIL_WIDTH)
}

/**
 * 峰窗的规范形：夹进一天之内、丢掉空窗、按起点排序。
 * 判档（{@link toneAtMinute}）刻意**不走这里** —— 它按宿主下发的原始窗口判，
 * 少一层规范化就少一处可能与宿主分叉的地方。
 */
function normalizeWindows(profile: TierShapeSource): (readonly [number, number])[] {
  return profile.peakWindows
    .map(([from, to]) => [clampMinute(from), clampMinute(to)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
}

function block(from: number, to: number): RailBlock {
  return { from, to, x: from, width: to - from }
}

/** 一段弧的 SVG path：半径与环心都取自 RING_*，调用方不必知道坐标系。 */
function arcPath(arc: RingArc): string {
  const from = polar(arc.startAngle, RING_RADIUS)
  const to = polar(arc.endAngle, RING_RADIUS)
  const large = arc.endAngle - arc.startAngle > 180 ? 1 : 0
  return `M${round(from.x)},${round(from.y)}A${RING_RADIUS},${RING_RADIUS} 0 ${large} 1 ${round(to.x)},${round(to.y)}`
}

/**
 * 极坐标 → 画布坐标。角度 0 = 正上，顺时针增加。
 * 角度本身由 {@link angleAt} 给，起点是 {@link RING_START_ANGLE}。
 *
 * 结果一律四舍五入到 3 位小数：三角函数在 0° / 90° / 180° / 270° 上会留下 1e-15 的尾巴
 * （`sin(2π)` 不是 0）。留着的后果是「00:00 在正上方」这句话只能写成近似，
 * 而它本来就是精确的 —— 一像素的千分之一，肉眼与断言都该当作精确。
 */
function polar(angle: number, radius: number): RingPoint {
  const radians = (angle * Math.PI) / 180
  return {
    x: round(RING_CENTER_X + radius * Math.sin(radians)),
    y: round(RING_CENTER_Y - radius * Math.cos(radians)),
  }
}

/** 写进 d / 线段端点的小数只留 3 位：三角函数算出来的值最容易长一截没用的浮点尾巴。 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 半天内的分钟（0..720）→ 角度（度）。**不做取模**，所以一圈的终点给出 360 而不是 0。
 *
 * 与 {@link angleAt} 只差这一处，但它是关键的一处：弧的终点必须**大于**起点，
 * 归成 0 会让 SVG 的 A 命令顺着画回去（270°→0° 成了反着走 270°）。
 * 时刻走 angleAt（12:00 与 00:00 都归于正上方），弧的端点走这个。
 */
function angleInTurn(localMinute: number): number {
  return RING_START_ANGLE + (localMinute / RING_MINUTES_PER_TURN) * 360
}

/**
 * 分钟 → 角度（度）。**一天两圈**：一圈 {@link RING_MINUTES_PER_TURN} 分钟摊在 360° 上，
 * 所以每分钟 0.5°、满一圈回到起点。
 * 取模而不是夹住：13:00 要落在 01:00 的位置上，这正是「一天两圈」。
 */
function angleAt(minute: number): number {
  return angleInTurn(clampMinute(minute) % RING_MINUTES_PER_TURN)
}

/** 半天序号：0 = 上午（00:00-12:00），1 = 下午（12:00-24:00）。 */
function halfOf(minute: number): number {
  return clampMinute(minute) < RING_MINUTES_PER_TURN ? 0 : 1
}

/**
 * 把一天的峰窗裁进指定半天，并换算成**半天内**的分钟。
 *
 * 12 小时盘上「同一条弧 = 两个时刻」，一圈只能画一套弧，所以先裁出这半天再画。
 * 横跨正午或午夜的窗（如 11:00-14:00）在这里被切开：两半各画自己那一段，
 * 拼起来仍是原来那个窗，一分钟不多一分钟不少。
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

/**
 * **半天内**的峰窗 → 可画的弧段。端点走 {@link angleInTurn}（不做取模），
 * 所以「到半圈末尾为止」的窗给出 270°→360° 而不是 270°→0°。
 *
 * 半圈全占满（`[[0, 720]]`，也就是全天高峰）时起止角度是 0° 与 360°：两点重合，
 * SVG 的 A 命令什么都画不出来。所以跨度超过 180° 就拆成多段 —— 上限取 180 而不是 360，
 * 保证每一段都是能画的半圆以内。
 */
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
 * 弹窗那条**双轨**：上轨高峰价、下轨空闲价。
 *
 * 两块合起来是一天的划分 —— 高峰窗进 `peakBlocks`，剩下的补进 `valleyBlocks`，
 * 所以任何一天、任何窗口配置下两串块都**不重不漏**（重叠的窗会被下轨那侧按 `cursor` 吃掉，
 * 不会画出两条互相盖住的蓝块）。
 * 没有窗口的日子（周末 / 节假日）没有形状可画：上轨空着，下轨一条通到底的蓝块，是诚实的。
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

/** 某一档压在哪条轨上 —— 组件与「现在」点共用，免得两处各写一个三元表达式。 */
export function railYOf(tone: TierTone): number {
  return tone === 'peak' ? RAIL_PEAK_Y : RAIL_VALLEY_Y
}

/**
 * 侧栏那个 **12 小时钟盘**（一天两圈）。
 *
 * 一圈 {@link RING_MINUTES_PER_TURN} 分钟、一天转两圈，12:00 与 00:00 都在正上方
 * （{@link RING_START_ANGLE} = 0）。弧只画 **`minute` 所在的那半天** —— 这是 12 小时盘
 * 唯一自洽的画法：同一条弧对应两个时刻，一天两圈的盘上只有一套弧，只画半天才不会说谎。
 * 为什么这么定，见文件头「mini 为什么是一天两圈的 12 小时盘」。
 *
 * **环上没有刻度**：它是「一根普通粗环 + 一段段弧」，不是仪表盘；
 * 方位对不对由断言钉（整点误差精确为 0），不靠环上那几笔。
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

/**
 * 此刻的档位。**判档只有契约里那一份实现**（`../../shape/index.ts` 的
 * `toneAtMinute`）—— 形状与宿主各判一遍，「点压在弧上」和「宿主收的价」就可能错开一分钟。
 *
 * 这里只把**判档口径翻译成画面口径**：契约说钱（peak / offPeak），画面说高低（peak / valley）。
 */
export function toneAtMinute(profile: TierShapeSource, minute: number): TierTone {
  return toneOf(profile.peakWindows, minute) === 'peak' ? 'peak' : 'valley'
}

/** 轴上的分钟 → `HH:MM`。形状也要显示时刻，所以同样只有契约那一份实现。 */
export function clockText(minute: number): string {
  return clockTextOf(minute)
}

/** 小节标题：非工作日要在标题里就说清楚，否则「全天空闲」看着像数据没加载。 */
export function curveTitleText(profile: TierShapeSource): string {
  return profile.workday ? '今日费率' : '今日费率（非工作日）'
}

/** 右上角那行：「现在 10:32 · 高峰」。 */
export function nowText(profile: TierShapeSource, minute: number): string {
  const tone = toneAtMinute(profile, minute) === 'peak' ? '高峰' : '空闲'
  return `现在 ${clockText(minute)} · ${tone}`
}

/** 无障碍名：整张图是一个位图，读屏只能从文案里拿到窗口与此刻的档位。 */
export function curveAriaLabel(profile: TierShapeSource, minute: number): string {
  const windowsText = profile.peakWindows
    .map(([from, to]) => `${clockText(from)} 到 ${clockText(to)}`)
    .join('、')
  const shape = profile.workday ? `高峰 ${windowsText}，其余按空闲价` : '今日非工作日，全天按空闲价'
  return `今日费率（0 点到 24 点）：${shape}；${nowText(profile, minute)}`
}
