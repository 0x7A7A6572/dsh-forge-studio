/**
 * 今日费率形状的几何门禁（纯函数，不渲染）。
 *
 * 这个模块给**两张形状**，共用同一条等分时间轴（0..1440 分钟按 1:1 摊开）：
 * `tierRails`（弹窗那条双轨：上轨高峰价 / 下轨空闲价）与 `tierRing`
 * （侧栏 75×35 的 12 小时钟盘，一天两圈）。下面按「轴 → 对齐 → 双轨 → 时钟 → 判档 → 文案」分组钉住。
 *
 * 时间轴那张（两条共用）：
 * - **位置 = 时刻**。旧版是注意力轴（深夜 ×0.12），现在等分 —— 因为双轨只有两个高度，
 *   压不压扁都读得出来，而等分换来的是轨上的横坐标与环上的角度**是同一把尺子**，
 *   两处读数不可能分叉。这条在「同一把尺子」那一节里是断言，不是注释。
 *
 * 对齐（本次改版的起因）：
 * - 一天两圈：一圈 12 小时，12:00 与 00:00 都在正上、06:00 与 18:00 都在正下，
 *   03:00 与 15:00 正右、09:00 与 21:00 正左，**误差精确为 0** —— 与机械钟同一个读法；
 * - 1440 分钟全扫：点落在琥珀弧内 ⟺ 该分钟判为高峰。这条是「正好对上时间点」的功能契约，
 *   不是外观检查 —— 弧的覆盖范围与判档口径一旦分叉，它就是红的。
 * - 12 小时盘上同一条弧对应**两个**时刻，所以弧只画此刻那半天。为什么必须这样、
 *   不这样又会在多少格里说谎，下面有两条把 420 / 720 这个数钉住的断言。
 *
 * 双轨：
 * - 上轨的块**就是**峰窗（左闭右开），下轨补满剩下的时段；两块合起来不重不漏地切完一整天。
 * - 非工作日没有形状可画：上轨空着、下轨一条通到底 —— 一条诚实的平块好过编出来的起伏。
 * - 落差杆画在两条轨之间，所以「半价」这件事有一个几何位置可指认（见 core 里的 railYOf）。
 *
 * 材质（本次改版的第二件事）：
 * - 档位不再是一条实心圆头描边（那是进度条的画法），而是「落差光场 + 发丝亮芯」。
 *   光场把「半价」画成一片有颜色的东西、全天常驻；亮芯是「一根细芯 + 一层弥散」，
 *   沿一天有浓淡（正午最亮、两头压暗）。两个表都只写 offset 与 alpha，下面的断言把它们
 *   钉在「中间最透明 / 两头最浓」「正午最亮 / 两头压暗」上 —— 换主题换色不该动它们一行。
 * - 芯的浓淡走**全天一条**渐变（不是每段一条）：每段一条必然让每段两端自己淡下去，
 *   段与段的边界就跟着糊了；亮度可以淡，边界不能淡。
 *
 * 时钟：
 * - 一天两圈：起点由 RING_START_ANGLE 钉在**正上方**（取 0），每分钟 0.5°，
 *   满 720 分钟（12 小时）走满 360° 后回到起点，一天转两圈。
 * - 弧**只画 minute 所在那半天**：同一条弧对应两个时刻，一圈画不下两套弧。
 *   守卫是那条 1440 分钟全扫的断言 —— 它在一天两圈下依然每分钟成立，因为
 *   「此刻这半天」与「此刻的角度」永远出自同一个 minute。
 * - **环上没有刻度**（本次改版去掉的）。从前靠 24 格刻度肉眼核对方位，现在那条口径落在
 *   断言里：整点方位误差精确为 0，且起点常数本身被钉住 —— 想改角度就得先改这条断言。
 * - 「现在」那颗珠子全天都留在画布之内（连它那圈晕算上），不会画出去半个点；
 *   而且它的**可见半径是从 CSS 读回来的**：珠子是 CSS 粒子，尺寸写死在样式表里，
 *   所以这里把 .miniRingDot 那条规则解析出来核对 —— 几何常数与样式表不许各说各话。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  RAIL_BEAM_LAYERS, RAIL_CORE_LAYERS, RAIL_CORE_STOPS, RAIL_FIELD_BLEED, RAIL_FIELD_STOPS,
  RAIL_HEIGHT, RAIL_PEAK_Y, RAIL_VALLEY_Y, RAIL_WIDTH,
  RING_CENTER_X, RING_CENTER_Y, RING_DOT_REACH, RING_HEIGHT, RING_MINUTES_PER_TURN,
  RING_RADIUS, RING_START_ANGLE, RING_WIDTH,
  clockText, curveAriaLabel, curveTitleText, nowText, railYOf, tierRails, tierRing, toneAtMinute,
} from '../packages/plugin-usage-billing/src/client/core/tier-curve.ts'
import { ruleMinuteOfDay } from '../packages/plugin-usage-billing/src/client/hooks/useRuleMinute.ts'
import type { TierDayProfile } from '../packages/plugin-usage-billing/src/pricing/tiers.ts'

const workday: TierDayProfile = {
  workday: true,
  peakWindows: [[540, 720], [840, 1080]],
  offPeakRatio: 0.5,
  utcOffsetMinutes: 480,
}
const weekend: TierDayProfile = { ...workday, workday: false, peakWindows: [] }

/**
 * 「现在」那颗珠子是 **CSS 粒子**：盒子多大、渐变在几个百分比处收干净，都写在样式表里
 * （.miniRingDot）—— 几何模块只知道它的可见半径 RING_DOT_REACH。
 * 两处各写一遍就一定会漂，所以这里把那条规则读回来核对。
 */
function ringDotRule(): string {
  const css = readFileSync(
    join(
      fileURLToPath(new URL('..', import.meta.url)),
      'packages/plugin-usage-billing/src/client/styles/settings-section.module.css',
    ),
    'utf8',
  )
  const body = /\.miniRingDot\s*\{([^}]*)\}/.exec(css)?.[1]
  if (body === undefined) throw new Error('样式表里找不到 .miniRingDot 规则')
  return body
}

describe('时间轴是等分轴：位置就是时刻', () => {
  it('横坐标就是分钟本身：0 → 0、12:00 → 720、24:00 → 1440', () => {
    const rails = tierRails(workday)
    expect(rails.x(0)).toBe(0)
    expect(rails.x(720)).toBe(720)
    expect(rails.x(RAIL_WIDTH)).toBe(RAIL_WIDTH)
  })
  it('横轴只有一天：越界的分钟被夹回两端', () => {
    const rails = tierRails(workday)
    expect(rails.x(-120)).toBe(0)
    expect(rails.x(2000)).toBe(RAIL_WIDTH)
  })
  it('环上每分钟 0.5°：一天两圈，720 分钟走满 360° 后回到起点', () => {
    const ring = tierRing(workday, 0)
    expect(ring.angle(0)).toBe(0)
    expect(ring.angle(360)).toBe(180) // 06:00 在正下方
    expect(ring.angle(720)).toBe(0) // 12:00 回到正上方
    expect(ring.angle(1080)).toBe(180) // 18:00 又在正下方
    expect(ring.angle(1440)).toBe(0) // 24:00 = 00:00
    expect(ring.angle(1) - ring.angle(0)).toBeCloseTo(0.5, 10)
    // 只在一圈之内严格单调；跨圈是回到起点（360° 的下一格就是 0°），不是继续累加。
    for (let minute = 1; minute < RING_MINUTES_PER_TURN; minute++) {
      expect(ring.angle(minute)).toBeGreaterThan(ring.angle(minute - 1))
    }
    expect(ring.angle(RING_MINUTES_PER_TURN)).toBeLessThan(ring.angle(RING_MINUTES_PER_TURN - 1))
  })
  it('一天两圈：两个时刻共用一个角度，且正好相差 12 小时（一圈 720 个位置两两不同）', () => {
    const ring = tierRing(workday, 0)
    for (let minute = 0; minute < RING_MINUTES_PER_TURN; minute++) {
      expect(ring.angle(minute + RING_MINUTES_PER_TURN)).toBe(ring.angle(minute))
    }
    const positions = new Set(Array.from({ length: RING_MINUTES_PER_TURN }, (_, m) => ring.angle(m)))
    expect(positions.size).toBe(RING_MINUTES_PER_TURN)
    expect(RING_MINUTES_PER_TURN).toBe(RAIL_WIDTH / 2)
  })
  it('轨上的横坐标与环上的角度是同一把尺子 —— 环只是把它折成了两圈', () => {
    const rails = tierRails(workday)
    const ring = tierRing(workday, 0)
    // 同一个半天里，轨上走多少分钟，环上就转多少度：比例恒为 360 / 720。
    // 每对都取在半圈之内 —— 跨过半圈末尾时环的角度按 360 取模回到正上方（另有一条断言钉住）。
    for (const [a, b] of [[0, 360], [540, 719], [840, 1080], [720, 1439]] as const) {
      const railSpan = rails.x(b) - rails.x(a)
      expect(ring.angle(b) - ring.angle(a)).toBeCloseTo((railSpan / RING_MINUTES_PER_TURN) * 360, 10)
    }
    expect(ring.angle(0)).toBe(RING_START_ANGLE)
  })
})

describe('「正好对上时间点」：整点方位精确、全天覆盖、弧只画半天', () => {
  it('00:00 与 12:00 都在正上方、06:00 与 18:00 都在正下方 —— 误差精确为 0', () => {
    const ring = tierRing(workday, 0)
    const top = { x: RING_CENTER_X, y: RING_CENTER_Y - RING_RADIUS }
    const right = { x: RING_CENTER_X + RING_RADIUS, y: RING_CENTER_Y }
    const bottom = { x: RING_CENTER_X, y: RING_CENTER_Y + RING_RADIUS }
    const left = { x: RING_CENTER_X - RING_RADIUS, y: RING_CENTER_Y }
    // 一天两圈：每个方位都有**两个**整点，这正是它读起来跟机械钟一样的原因。
    expect(ring.point(0)).toEqual(top) // 00:00
    expect(ring.point(720)).toEqual(top) // 12:00
    expect(ring.point(180)).toEqual(right) // 03:00
    expect(ring.point(900)).toEqual(right) // 15:00
    expect(ring.point(360)).toEqual(bottom) // 06:00
    expect(ring.point(1080)).toEqual(bottom) // 18:00
    expect(ring.point(540)).toEqual(left) // 09:00
    expect(ring.point(1260)).toEqual(left) // 21:00
  })
  it('点的圆心全天都压在同一半径的环上（不会漂到环内或环外）', () => {
    const ring = tierRing(workday, 0)
    for (let minute = 0; minute <= 1440; minute += 5) {
      const at = ring.point(minute)
      expect(Math.hypot(at.x - RING_CENTER_X, at.y - RING_CENTER_Y)).toBeCloseTo(RING_RADIUS, 2)
    }
  })
  it('1440 分钟全扫：点落在琥珀弧内 ⟺ 该分钟判为高峰（一天两圈下依然每分钟成立）', () => {
    // 这条在 12 小时盘上成立不是巧合：弧取的是 minute 所在那半天，点取的是同一个 minute。
    for (let minute = 0; minute < RAIL_WIDTH; minute++) {
      const ring = tierRing(workday, minute)
      const at = ring.angle(minute)
      const inArc = ring.arcs.some(arc => at >= arc.startAngle && at < arc.endAngle)
      expect(inArc, clockText(minute)).toBe(toneAtMinute(workday, minute) === 'peak')
    }
  })
  it('12 小时盘的固有矛盾：720 个刻度格里 420 格的两个时刻档位相反', () => {
    // 例：10:00 高峰 / 22:00 空闲落在同一格。一圈只画一套弧，这 420 格里必有一半在说谎 ——
    // 这就是「弧只画此刻那半天」的量化理由，下面那条断言把它守住。
    let conflict = 0
    for (let slot = 0; slot < RING_MINUTES_PER_TURN; slot++) {
      if (toneAtMinute(workday, slot) !== toneAtMinute(workday, slot + RING_MINUTES_PER_TURN)) conflict++
    }
    expect(conflict).toBe(420)
  })
  it('弧只画此刻那半天：同一个角度、两个时刻，弧不一样，点因此永远压在真实的档位上', () => {
    const morning = tierRing(workday, 600) // 10:00
    const evening = tierRing(workday, 1320) // 22:00 —— 与 10:00 共用同一个角度
    expect(morning.angle(600)).toBe(evening.angle(1320))
    expect(morning.arcs.map(arc => [arc.from, arc.to])).toEqual([[540, 720]])
    expect(evening.arcs.map(arc => [arc.from, arc.to])).toEqual([[120, 360]])
    const at = morning.angle(600)
    const onArc = (ring: typeof morning) => ring.arcs.some(arc => at >= arc.startAngle && at < arc.endAngle)
    expect(onArc(morning)).toBe(true) // 10:00 是高峰，点在弧上
    expect(onArc(evening)).toBe(false) // 22:00 是空闲，同样角度上什么都没画
  })
  it('横跨正午的窗被切成两段：两半各画自己那一段，拼起来还是原来那个窗', () => {
    const across = { ...workday, peakWindows: [[660, 840]] as const } // 11:00-14:00
    const morning = tierRing(across, 660) // 11:00 还在上午这半
    const afternoon = tierRing(across, 720) // 12:00 已进入下午这半
    expect(morning.arcs.map(arc => [arc.from, arc.to])).toEqual([[660, 720]])
    expect(afternoon.arcs.map(arc => [arc.from, arc.to])).toEqual([[0, 120]])
    // 角度上两段首尾相接：330°→360° 与 0°→60°，在正上方接上。
    expect(morning.arcs[0]!.startAngle).toBeCloseTo(330, 10)
    expect(morning.arcs[0]!.endAngle).toBeCloseTo(360, 10)
    expect(afternoon.arcs[0]!.startAngle).toBeCloseTo(0, 10)
    expect(afternoon.arcs[0]!.endAngle).toBeCloseTo(60, 10)
  })
})

describe('双轨：上轨的块就是峰窗，下轨补满剩下的时段', () => {
  it('高峰块 = 峰窗本身，起止即时刻、宽度即时长', () => {
    const rails = tierRails(workday)
    expect(rails.peakBlocks.map(b => [b.from, b.to])).toEqual([[540, 720], [840, 1080]])
    expect(rails.peakBlocks.map(b => [b.x, b.width])).toEqual([[540, 180], [840, 240]])
  })
  it('下轨 = 0-9 点、12-14 点、18-24 点', () => {
    const rails = tierRails(workday)
    expect(rails.valleyBlocks.map(b => [b.from, b.to])).toEqual([[0, 540], [720, 840], [1080, 1440]])
  })
  it('两块合起来不重不漏：按 start 排好正好首尾相接切完一整天', () => {
    const rails = tierRails(workday)
    const all = [...rails.peakBlocks, ...rails.valleyBlocks].sort((a, b) => a.from - b.from)
    let cursor = 0
    for (const block of all) {
      expect(block.from).toBe(cursor)
      cursor = block.to
    }
    expect(cursor).toBe(RAIL_WIDTH)
  })
  it('非工作日没有形状可画：上轨空着，下轨一条通到底', () => {
    const rails = tierRails(weekend)
    expect(rails.peakBlocks).toEqual([])
    expect(rails.valleyBlocks.map(b => [b.from, b.to])).toEqual([[0, 1440]])
  })
  it('窄窗（10 分钟）仍是一块 10 单位宽的琥珀，不会被夹没', () => {
    const rails = tierRails({ ...workday, peakWindows: [[600, 610]] })
    expect(rails.peakBlocks.map(b => [b.from, b.to, b.width])).toEqual([[600, 610, 10]])
    expect(rails.valleyBlocks.map(b => [b.from, b.to])).toEqual([[0, 600], [610, 1440]])
  })
  it('峰窗互相重叠这种退化配置也不炸：上轨叠了两块（视觉无害），下轨绝不重叠', () => {
    const rails = tierRails({ ...workday, peakWindows: [[540, 900], [600, 700]] })
    expect(rails.valleyBlocks[0]!.from).toBe(0)
    expect(rails.valleyBlocks[rails.valleyBlocks.length - 1]!.to).toBe(RAIL_WIDTH)
    for (let i = 1; i < rails.valleyBlocks.length; i++) {
      expect(rails.valleyBlocks[i]!.from).toBeGreaterThanOrEqual(rails.valleyBlocks[i - 1]!.to)
    }
  })
  it('第一个峰窗就压在 0 点上时，下轨不会先补出一段零宽的块', () => {
    const rails = tierRails({ ...workday, peakWindows: [[0, 60], [1380, 1440]] })
    expect(rails.peakBlocks.map(b => [b.from, b.to])).toEqual([[0, 60], [1380, 1440]])
    expect(rails.valleyBlocks.map(b => [b.from, b.to])).toEqual([[60, 1380]])
  })
  it('两档各自的轨高：上轨在峰线、下轨在谷线，且上下关于中线对称', () => {
    expect(railYOf('peak')).toBe(RAIL_PEAK_Y)
    expect(railYOf('valley')).toBe(RAIL_VALLEY_Y)
    expect(RAIL_PEAK_Y + RAIL_VALLEY_Y).toBeCloseTo(RAIL_HEIGHT, 10)
  })
})

describe('材质：落差光场与发丝亮芯', () => {
  it('光场中间最透明、两端最浓，两侧各自单调', () => {
    const upper = RAIL_FIELD_STOPS.filter(stop => stop.at <= 0.5)
    const lower = RAIL_FIELD_STOPS.filter(stop => stop.at >= 0.5)
    expect(upper.length).toBeGreaterThan(1)
    expect(lower.length).toBeGreaterThan(1)
    for (let i = 1; i < upper.length; i++) {
      expect(upper[i]!.alpha).toBeLessThan(upper[i - 1]!.alpha)
    }
    for (let i = 1; i < lower.length; i++) {
      expect(lower[i]!.alpha).toBeGreaterThan(lower[i - 1]!.alpha)
    }
    const middle = RAIL_FIELD_STOPS.find(stop => stop.at === 0.5)!
    expect(middle.alpha).toBe(0)
    expect(RAIL_FIELD_STOPS[0]!.alpha).toBeGreaterThan(0)
    expect(RAIL_FIELD_STOPS[RAIL_FIELD_STOPS.length - 1]!.alpha).toBeGreaterThan(0)
  })
  it('光场色相在 0.5 处换手：上半天峰色、下半天谷色（靠一个 alpha 为 0 的停点）', () => {
    for (const stop of RAIL_FIELD_STOPS) {
      expect(stop.tone, String(stop.at)).toBe(stop.at < 0.5 ? 'peak' : 'valley')
    }
  })
  it('光场外扩一点点：贴着轨线切会留下一条硬边', () => {
    expect(RAIL_FIELD_BLEED).toBeGreaterThan(0)
    // 外扩之后整片仍然留在画布之内（描边按设备像素恒定，不吃画布高度）。
    expect(RAIL_PEAK_Y - RAIL_FIELD_BLEED).toBeGreaterThan(0)
    expect(RAIL_VALLEY_Y + RAIL_FIELD_BLEED).toBeLessThan(RAIL_HEIGHT)
  })
  it('三个表都是能从 0 走到 1 的合法渐变（offset 递增、首尾齐）', () => {
    for (const table of [RAIL_FIELD_STOPS, RAIL_CORE_STOPS.peak, RAIL_CORE_STOPS.valley]) {
      const offsets = table.map(stop => stop.at)
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
      expect(offsets[0]).toBe(0)
      expect(offsets[offsets.length - 1]).toBe(1)
    }
  })
  it('亮芯沿一天走：正午最亮、两头压到一半以下，两侧各自单调', () => {
    for (const tone of ['peak', 'valley'] as const) {
      const stops = RAIL_CORE_STOPS[tone]
      const upper = stops.filter(stop => stop.at <= 0.5)
      const lower = stops.filter(stop => stop.at >= 0.5)
      for (let i = 1; i < upper.length; i++) {
        expect(upper[i]!.alpha, tone).toBeGreaterThanOrEqual(upper[i - 1]!.alpha)
      }
      for (let i = 1; i < lower.length; i++) {
        expect(lower[i]!.alpha, tone).toBeLessThanOrEqual(lower[i - 1]!.alpha)
      }
      expect(stops.find(stop => stop.at === 0.5)!.alpha, tone).toBe(1)
      expect(stops[0]!.alpha, tone).toBeLessThan(0.6)
      expect(stops[stops.length - 1]!.alpha, tone).toBeLessThan(0.6)
    }
  })
  it('亮芯层数恰好两层：一层弥散 + 一根芯（再多就成一团雾，段边界会糊）', () => {
    expect([...RAIL_CORE_LAYERS]).toEqual([0, 1])
  })
  it('光柱恰好三层（最宽那层是弥散）', () => {
    expect([...RAIL_BEAM_LAYERS]).toEqual([0, 1, 2])
  })
})

describe('时钟：一天两圈的峰弧、半天换弧、以及全天的点', () => {
  it('上午那半画 09:00-12:00（270°-360°），下午那半画 14:00-18:00（60°-180°）', () => {
    const morning = tierRing(workday, 0).arcs
    expect(morning.map(arc => [arc.from, arc.to])).toEqual([[540, 720]])
    expect(morning[0]!.startAngle).toBeCloseTo(270, 10)
    expect(morning[0]!.endAngle).toBeCloseTo(360, 10)
    const afternoon = tierRing(workday, 720).arcs
    expect(afternoon.map(arc => [arc.from, arc.to])).toEqual([[120, 360]])
    expect(afternoon[0]!.startAngle).toBeCloseTo(60, 10)
    expect(afternoon[0]!.endAngle).toBeCloseTo(180, 10)
    // 两半的琥珀加起来仍是一整天的 420 分钟，一分钟不多一分钟不少。
    const minutes = (arcs: readonly { from: number, to: number }[]) => arcs.reduce((sum, arc) => sum + (arc.to - arc.from), 0)
    expect(minutes(morning) + minutes(afternoon)).toBe(420)
  })
  it('弧路径是单条 A 命令，半径取自环半径', () => {
    const ring = tierRing(workday, 600)
    expect(ring.arcPaths).toHaveLength(1)
    for (const d of ring.arcPaths) {
      expect(d).toMatch(new RegExp(`^M[\\d.]+,[\\d.]+A${RING_RADIUS},${RING_RADIUS} 0 [01] 1 [\\d.]+,[\\d.]+$`))
    }
  })
  it('一整天都是高峰时圆环仍画得出来：半圈被拆成两段各 180°（两半都一样）', () => {
    for (const minute of [0, 720]) {
      const ring = tierRing({ ...workday, peakWindows: [[0, 1440]] }, minute)
      expect(ring.arcs.map(arc => arc.endAngle - arc.startAngle)).toEqual([180, 180])
      expect(ring.arcPaths).toHaveLength(2)
    }
  })
  it('环上没有刻度：起点角度写死在正上方（钟面的 12 点）', () => {
    // 环只剩「一根粗环 + 几段弧 + 一个点」，方位没有刻度可数，全靠这个常数。
    expect(RING_START_ANGLE).toBe(0)
    expect(tierRing(workday, 0).angle(0)).toBe(RING_START_ANGLE)
    expect(tierRing(workday, 0).angle(RING_MINUTES_PER_TURN)).toBe(RING_START_ANGLE)
  })
  it('起点换成别的角度时整圈一起转（弧与点同源，不会一处转一处不转）', () => {
    // 这里是拿「角度就是 起点 + 半天内时刻占一圈的比例」这条恒等式当断言，
    // 而不是去读渲染结果：弧和点都从 angleAt 出来，只要这条成立，两处就不可能分叉。
    const ring = tierRing(workday, 600)
    for (const minute of [0, 540, 720, 1080, 1440]) {
      const local = minute % RING_MINUTES_PER_TURN
      expect(ring.angle(minute)).toBe(RING_START_ANGLE + (local / RING_MINUTES_PER_TURN) * 360)
    }
    for (const arc of ring.arcs) {
      expect(arc.startAngle).toBe(RING_START_ANGLE + (arc.from / RING_MINUTES_PER_TURN) * 360)
      expect(arc.endAngle).toBe(RING_START_ANGLE + (arc.to / RING_MINUTES_PER_TURN) * 360)
    }
  })
  it('「现在」那颗珠子连它那圈晕，全天都留在画布之内', () => {
    const ring = tierRing(workday, 0)
    for (let minute = 0; minute <= 1440; minute += 5) {
      const at = ring.point(minute)
      expect(at.x - RING_DOT_REACH).toBeGreaterThan(0)
      expect(at.x + RING_DOT_REACH).toBeLessThan(RING_WIDTH)
      expect(at.y - RING_DOT_REACH).toBeGreaterThan(0)
      expect(at.y + RING_DOT_REACH).toBeLessThan(RING_HEIGHT)
    }
  })
  it('珠子的可见半径由 CSS 决定：RING_DOT_REACH = 半盒 × 最外那层收尾', () => {
    const rule = ringDotRule()
    const box = Number(/width:\s*([\d.]+)px/.exec(rule)?.[1])
    expect(box).toBeGreaterThan(0)
    // 两层同色渐变，各有一个收尾百分比；外面那层决定可见半径（里面那层是核）。
    const stops = [...rule.matchAll(/transparent\s+([\d.]+)%/g)].map(m => Number(m[1]))
    expect(stops).toHaveLength(2)
    const reach = (box / 2) * (Math.max(...stops) / 100)
    expect(reach).toBeCloseTo(RING_DOT_REACH, 10)
    // 珠子必须比环的半宽（2.5）胖 —— 否则它整个陷在环里，既没有珠子的形，
    // 又会逼着人再拿一圈底色把环挖开（旧版就是这么走回断口的）。
    expect(reach).toBeGreaterThan(2.5)
    // 配方里不许再出现面板色/底色那一层：那正是当初把环挖断的东西。
    expect(rule).not.toMatch(/panel|sidebar-fill|bg-base/)
  })
  it('周末没有峰：一段弧都没有，整圈只剩底色环（一根诚实的素环）', () => {
    for (const minute of [0, 600, 720, 1320]) {
      const ring = tierRing(weekend, minute)
      expect(ring.arcs).toEqual([])
      expect(ring.arcPaths).toEqual([])
    }
  })
  it('峰窗按分钟乱序下发时仍然有序（弧不许倒着画）', () => {
    const ring = tierRing({ ...workday, peakWindows: [[840, 1080], [540, 720]] }, 600)
    expect(ring.arcs.map(arc => arc.startAngle)).toEqual([...ring.arcs.map(arc => arc.startAngle)].sort((a, b) => a - b))
  })
  it('跨午夜的窗在下午这半里也画得出来（23:00-24:00 → 330°-360°）', () => {
    const ring = tierRing({ ...workday, peakWindows: [[1380, 1440]] }, 1400)
    expect(ring.arcs.map(arc => [arc.from, arc.to])).toEqual([[660, 720]])
    expect(ring.arcs[0]!.startAngle).toBeCloseTo(330, 10)
    expect(ring.arcs[0]!.endAngle).toBeCloseTo(360, 10)
  })
})

describe('色带与判档口径与宿主一致（只看窗口，不看画法）', () => {
  it('窗口左闭右开', () => {
    expect(toneAtMinute(workday, 539)).toBe('valley')
    expect(toneAtMinute(workday, 540)).toBe('peak')
    expect(toneAtMinute(workday, 719)).toBe('peak')
    expect(toneAtMinute(workday, 720)).toBe('valley')
    expect(toneAtMinute(workday, 840)).toBe('peak')
    expect(toneAtMinute(workday, 1080)).toBe('valley')
  })
  it('非工作日一律空闲', () => {
    for (const minute of [0, 600, 900, 1439]) expect(toneAtMinute(weekend, minute)).toBe('valley')
  })
  it('判档不经过规范化：越界的窗口不会把一天切出额外的峰', () => {
    // 判档刻意直接读宿主下发的原始窗口（少一层规范化就少一处可能与宿主分叉的地方），
    // 所以越界的窗口在它自己的区间内仍然算峰 —— 形状那侧才会把窗口夹回一天之内。
    expect(toneAtMinute({ ...workday, peakWindows: [[-60, 60]] }, 30)).toBe('peak')
    expect(tierRails({ ...workday, peakWindows: [[-60, 60]] }).peakBlocks.map(b => [b.from, b.to]))
      .toEqual([[0, 60]])
  })
})

describe('文案（带子上不再画，只给 tooltip 与读屏用）', () => {
  it('时刻格式', () => {
    expect(clockText(0)).toBe('00:00')
    expect(clockText(360)).toBe('06:00')
    expect(clockText(1439)).toBe('23:59')
  })
  it('非工作日在标题里说清楚，指针只报档位', () => {
    expect(curveTitleText(workday)).toBe('今日费率')
    expect(curveTitleText(weekend)).toBe('今日费率（非工作日）')
    expect(nowText(workday, 632)).toBe('现在 10:32 · 高峰')
    expect(nowText(workday, 780)).toBe('现在 13:00 · 空闲')
    expect(nowText(weekend, 632)).toBe('现在 10:32 · 空闲')
    expect(curveAriaLabel(workday, 632)).toContain('09:00 到 12:00、14:00 到 18:00')
    expect(curveAriaLabel(weekend, 632)).toContain('全天按空闲价')
    // tooltip 的那一行就是这个拼法：标题 · 时刻档位
    expect(`${curveTitleText(workday)} · ${nowText(workday, 632)}`).toBe('今日费率 · 现在 10:32 · 高峰')
  })
  it('规则时区的当日分钟（本机时区无关）', () => {
    expect(ruleMinuteOfDay(Date.UTC(2026, 8, 21, 2, 32), 480)).toBe(632) // 北京 10:32
    expect(ruleMinuteOfDay(Date.UTC(2026, 8, 20, 23, 30), 480)).toBe(450) // 北京 07:30
  })
})
