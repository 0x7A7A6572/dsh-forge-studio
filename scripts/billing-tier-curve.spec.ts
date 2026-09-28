/**
 * M 型费率带的几何门禁（纯函数，不渲染）。
 *
 * 这个模块给**两张形状**，共用同一条注意力轴：`tierCurve`（弹窗那条读数带，有平顶）与
 * `miniCurve`（侧栏 75×35 的感觉指示器，完全平滑）。下面两组分别钉住它们。
 *
 * 横轴那张（两条共用）：
 * - **横轴是注意力轴**：峰窗 ±90 分钟按 1:1 展开，之外的深夜压到 0.12 —— 0-6 点、21-24 点
 *   只占很小一截，整条线是 `_M_` 而不是 `___M____`；指针、「现在」共用同一个映射。
 * - 指针永远落在曲线上；判档口径必须与宿主一致（只看窗口，不看斜坡）。
 *
 * tierCurve（读数带）：
 * - **纵轴只有两级**：两个峰（9-12 / 14-18）在峰线、其余在谷线。平顶就是峰窗本身
 *   （价在那个区间是平的），起伏只发生在窗口两侧。
 * - **坡是圆肩不是折角**：坡宽 = 窗口长度的一半（90 / 120 分钟），smoothstep 两端斜率为 0 ——
 *   整条线读起来是一道平滑的 `m`。相邻两窗之间那两条相对的坡等比压到吃满间距，
 *   谷底正好落在两窗之间，不会被糊成一个平肩。
 *
 * miniCurve（感觉指示器）—— 与大图**刻意不同形**：
 * - 峰窗**没有平顶**，只在窗口中点取一次顶；谷分三级：窗间波谷、起点、夜角。
 * - **纵向骨架照抄一条 5 点的手绘路线**（起点 / 小峰 / 波谷 / 大峰 / 终点）：
 *   小峰只有大峰 62.5% 的高，终点（夜角）比起点低 —— 于是「上午小峰、下午大峰」靠**高度**
 *   分大小，不再靠宽度。
 * - 下坡只有一段：大峰到 24:00 一口气滑到底，中途不插锚点 —— 插了就必然在下坡中段顿出一个
 *   曲率跳变（斜率连续、曲率不连续），细线读起来是个软拐角。
 * - 角落（24 点）**就是全天最低点**；起点（00:00）停在半山腰，照参考那条的「起点 3 / 终点 2」。
 *   相邻锚点高度两两不等，所以一段 L 都不会产生。唯一的例外是没有峰窗的日子（周末）：整条压在
 *   夜线上。
 * - 纵向口径是 mini 自己的：大图那 44 单位里有 20 单位是边距，占掉 42% 的高，这里收窄到 30。
 */
import { describe, expect, it } from 'vitest'
import {
  CURVE_HEIGHT, CURVE_WIDTH, MINI_CURVE_HEIGHT, clockText, curveAriaLabel, curveTitleText,
  miniCurve, nowText, tierCurve, toneAtMinute,
} from '../packages/plugin-usage-billing/src/client/core/tier-curve.ts'
import type { TierCurve } from '../packages/plugin-usage-billing/src/client/core/tier-curve.ts'
import { ruleMinuteOfDay } from '../packages/plugin-usage-billing/src/client/hooks/useRuleMinute.ts'
import type { TierDayProfile } from '../packages/plugin-usage-billing/src/pricing/tiers.ts'

const workday: TierDayProfile = {
  workday: true,
  peakWindows: [[540, 720], [840, 1080]],
  offPeakRatio: 0.5,
  utcOffsetMinutes: 480,
}
const weekend: TierDayProfile = { ...workday, workday: false, peakWindows: [] }

/** 整点刻度（等分轴下用来对照；带子上不画刻度，只是坐标参照）。 */
const TICKS = [0, 360, 720, 1080, 1440]

/** 一段分钟摊在横轴上的宽度（viewBox 单位）。 */
function width(curve: TierCurve, from: number, to: number): number {
  return curve.x(to) - curve.x(from)
}

describe('横轴是注意力轴：深夜压扁、白天展开', () => {
  it('两端仍贴边：0 点在 x=0，24 点在 x=1440', () => {
    const curve = tierCurve(workday)
    expect(curve.x(0)).toBe(0)
    expect(curve.x(1440)).toBe(CURVE_WIDTH)
  })
  it('0-6 点压到 8% 宽以下、21-24 点压到 5% 以下（等分轴下是 25% / 12.5%）', () => {
    const curve = tierCurve(workday)
    expect(width(curve, 0, 360) / CURVE_WIDTH).toBeLessThan(0.08)
    expect(width(curve, 1260, 1440) / CURVE_WIDTH).toBeLessThan(0.05)
  })
  it('深夜的密度正好是白天的 0.12 倍', () => {
    const curve = tierCurve(workday)
    const night = width(curve, 0, 360) / 360
    const day = width(curve, 540, 720) / 180
    expect(night / day).toBeCloseTo(0.12, 10)
  })
  it('峰段几乎铺满：9-19 点占七成以上，12 点仍在中间', () => {
    const curve = tierCurve(workday)
    expect(width(curve, 540, 1140) / CURVE_WIDTH).toBeGreaterThan(0.7)
    expect(curve.x(720) / CURVE_WIDTH).toBeGreaterThan(0.3)
    expect(curve.x(720) / CURVE_WIDTH).toBeLessThan(0.5)
  })
  it('压缩不改变顺序：x 随分钟单调不减', () => {
    const curve = tierCurve(workday)
    let last = Number.NEGATIVE_INFINITY
    for (let minute = 0; minute <= CURVE_WIDTH; minute += 5) {
      const at = curve.x(minute)
      expect(at).toBeGreaterThanOrEqual(last)
      last = at
    }
  })
  it('没有窗口的日子退化成等分轴（周末的整点仍然等距）', () => {
    const curve = tierCurve(weekend)
    for (const tick of TICKS) expect(curve.x(tick)).toBeCloseTo(tick, 10)
  })
})

describe('曲线形状：两级平顶 + 圆肩过渡坡', () => {
  it('折点：平顶正好是峰窗，两侧圆肩各占窗口一半；相邻相对的坡压到吃满 12:00-14:00', () => {
    // 540-450 = 90（= 180 的一半）；720-540 = 180 平顶；771-720 = floor(90 × 120/210)；
    // 840-772 = floor(120 × 120/210)；1200-1080 = 120（= 240 的一半）。
    expect(tierCurve(workday).points.map((p) => p.minute)).toEqual([
      0, 450, 540, 720, 771, 772, 840, 1080, 1200, 1440,
    ])
  })
  it('只有两个高度：平顶在峰线、其余在谷线', () => {
    const curve = tierCurve(workday)
    const ys = curve.points.map((p) => p.y)
    expect(new Set(ys).size).toBe(2)
    const peak = Math.min(...ys)
    const valley = Math.max(...ys)
    expect(ys.filter((y) => y === peak)).toHaveLength(4) // 两段平顶各两个端点
    expect(curve.y(600)).toBe(peak)   // 10:00 平顶
    expect(curve.y(900)).toBe(peak)   // 15:00 平顶
    expect(curve.y(771)).toBe(valley) // 谷底（两窗之间）
    expect(curve.y(772)).toBe(valley)
    expect(curve.y(0)).toBe(valley)
    expect(curve.y(1439)).toBe(valley)
  })
  it('谷底落在两窗之间：不会因为坡太宽被抬起来', () => {
    const curve = tierCurve(workday)
    const valley = curve.y(0)
    expect(curve.y(771)).toBe(valley)
    // 两窗中点附近必须贴近谷底（剩余的抬升只有零点几个单位）
    expect(valley - curve.y(780)).toBeLessThan(1)
  })
  it('过渡坡是曲线不是斜线：两端平、四分之一处比线性更贴谷底', () => {
    const curve = tierCurve(workday)
    const peak = curve.y(600)
    const valley = curve.y(0)
    // 上坡 450 → 540（90 分钟）
    expect(curve.y(472.5)).toBeGreaterThan(valley - (valley - peak) * 0.25) // 缓入
    expect(curve.y(517.5)).toBeLessThan(valley - (valley - peak) * 0.75)    // 缓出
    expect(curve.y(495)).toBeCloseTo((peak + valley) / 2, 10)               // 中心对称
    expect(valley - curve.y(450.1)).toBeLessThan(0.01)                      // 起点斜率 0
    expect(curve.y(539.9) - peak).toBeLessThan(0.01)                        // 终点斜率 0
  })
  it('坡宽随窗口走：宽窗口的肩更圆（4 小时的窗口坡 120 分钟 > 3 小时的 90 分钟）', () => {
    const curve = tierCurve(workday)
    const rise1 = curve.points.find((p) => p.minute === 450)!
    expect(540 - rise1.minute).toBe(90)
    const fall2 = curve.points.find((p) => p.minute === 1200)!
    expect(fall2.minute - 1080).toBe(120)
  })
  it('路径里平坦段是 L、过渡坡是 C（每个窗口上下各一次）', () => {
    const line = tierCurve(workday).line
    expect(line).toMatch(/^M0,33/)
    expect(line.match(/C/g)).toHaveLength(4)
    expect(line.endsWith('L1440,33')).toBe(true)
  })
  it('指针的高度与路径同源：斜坡上也落在两线之间', () => {
    const curve = tierCurve(workday)
    expect(curve.y(520)).toBeGreaterThan(curve.y(600))
    expect(curve.y(520)).toBeLessThan(curve.y(780))
  })
  it('非工作日压平成一条谷线（起止两点都在同一高度）', () => {
    const curve = tierCurve(weekend)
    expect(curve.points.map((p) => p.y)).toEqual([33, 33])
    expect(curve.y(600)).toBe(curve.y(0))
    expect(curve.tones.every((t) => t.tone === 'valley')).toBe(true)
  })
  it('窄窗的坡不会叠成负宽（10 分钟的窗口 → 两侧各 5 分钟）', () => {
    const narrow: TierDayProfile = { ...workday, peakWindows: [[600, 610]] }
    const minutes = tierCurve(narrow).points.map((p) => p.minute)
    expect(minutes).toEqual([0, 595, 600, 610, 615, 1440])
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b))
  })
  it('路径收尾闭合到 24:00 与下沿（面积不外溢）', () => {
    expect(tierCurve(workday).area).toContain(`L${CURVE_WIDTH},${CURVE_HEIGHT}L0,${CURVE_HEIGHT}Z`)
  })
})

describe('miniCurve：完全平滑的 M（没有平顶、一段直线都没有；纵向骨架照抄参考那条 6 点路线）', () => {
  const MINI_PEAK = 4      // 大峰：最后一个峰窗的中点
  const MINI_SUB_PEAK = 12 // 小峰：第一个峰窗的中点
  const MINI_SADDLE = 20   // 窗间波谷
  const MINI_RAMP = 22     // 起点：00:00
  const MINI_VALLEY = 26   // 夜角：24:00（全天最低点）

  it('折点：起点在 00:00 的半山腰，两个峰在各自峰窗中点，波谷在两窗中间，收笔在 24:00 的夜角', () => {
    const curve = miniCurve(workday)
    expect(curve.points.map((p) => p.minute)).toEqual([0, 630, 780, 960, 1440])
    expect(curve.points.map((p) => p.y)).toEqual([
      MINI_RAMP, MINI_SUB_PEAK, MINI_SADDLE, MINI_PEAK, MINI_VALLEY,
    ])
  })
  it('纵向次序就是参考那条路线：终点 < 起点 < 波谷 < 小峰 < 大峰', () => {
    const order = [MINI_PEAK, MINI_SUB_PEAK, MINI_SADDLE, MINI_RAMP, MINI_VALLEY]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect([...order].sort((a, b) => b - a)).toEqual([
      MINI_VALLEY, MINI_RAMP, MINI_SADDLE, MINI_SUB_PEAK, MINI_PEAK,
    ])
  })
  it('小峰只有大峰 62.5% 的高：参考里 (5.5-3) / (7.5-3.5) = 2.5 / 4', () => {
    expect(MINI_RAMP - MINI_SUB_PEAK).toBe(10)
    expect(MINI_SADDLE - MINI_PEAK).toBe(16)
    expect((MINI_RAMP - MINI_SUB_PEAK) / (MINI_SADDLE - MINI_PEAK)).toBeCloseTo(2.5 / 4, 10)
  })
  it('峰锚点就是峰窗中点（630 = 09-12 的中点，960 = 14-18 的中点）', () => {
    const curve = miniCurve(workday)
    expect(curve.points.filter((p) => p.y === MINI_SUB_PEAK).map((p) => p.minute)).toEqual([630])
    expect(curve.points.filter((p) => p.y === MINI_PEAK).map((p) => p.minute)).toEqual([960])
  })
  it('高度一共五级；午间的波谷（20）比起点（22）浅', () => {
    const curve = miniCurve(workday)
    const depths = [...new Set(curve.points.map((p) => p.y))].sort((a, b) => a - b)
    expect(depths).toEqual([MINI_PEAK, MINI_SUB_PEAK, MINI_SADDLE, MINI_RAMP, MINI_VALLEY])
    expect(curve.y(780)).toBe(MINI_SADDLE)
    expect(curve.y(780)).toBeLessThan(MINI_RAMP)
  })
  it('起点在半山腰、收笔在最低的夜角：线不从角落里爬起来，收笔那一格才是全天最低点', () => {
    const curve = miniCurve(workday)
    // 参考那条的起点(3)本来就高于终点(2) —— 左边没有线可翘，它就是起笔高度。
    expect(curve.y(0)).toBe(MINI_RAMP)
    expect(curve.y(1440)).toBe(MINI_VALLEY)
    // 全天任何一刻都不比收笔的夜角更低（y 都不更大）
    for (let minute = 0; minute <= 1440; minute += 5) {
      expect(curve.y(minute)).toBeLessThanOrEqual(MINI_VALLEY)
    }
    // 而且它不是一段平底：起手一小时就在往峰上爬，09:00 已经走了一半路
    expect(curve.y(60)).toBeLessThan(MINI_RAMP)
    expect(curve.y(540)).toBeGreaterThan(MINI_SUB_PEAK)
    expect(curve.y(540)).toBeLessThan(MINI_RAMP)
  })
  it('一段直线都没有：整条路 4 段全是 C、0 段 L', () => {
    const curve = miniCurve(workday)
    expect(curve.line.match(/C/g)).toHaveLength(4)
    expect(curve.line.match(/L/g)).toBeNull()
    expect(curve.line.startsWith(`M0,${MINI_RAMP}C`)).toBe(true)
  })
  it('只有真正的极值点才是水平的：两个峰与中间的波谷；两端都带真实斜率', () => {
    const curve = miniCurve(workday)
    // 峰、波谷：左右 1 分钟的差可以忽略 → 切线水平，顶点就落在锚点上
    for (const minute of [630, 780, 960]) {
      const y = curve.y(minute)
      expect(Math.abs(curve.y(minute - 1) - y)).toBeLessThan(0.01)
      expect(Math.abs(curve.y(minute + 1) - y)).toBeLessThan(0.01)
    }
    // 两个端点斜着切进 / 切出画布：起手 1 小时就已经在正常抬升（收平时这里只有 0.03）
    expect(curve.y(0) - curve.y(60)).toBeGreaterThan(0.1)
    expect(curve.y(1440) - curve.y(1380)).toBeGreaterThan(0.1)
  })
  it('下坡只有一段：16:00 到 24:00 之间斜率单调升完再单调降，中途没有拐点', () => {
    const curve = miniCurve(workday)
    // 屏幕口径：按 x 均匀取样。轴在 19:30 有个密度拐点（1.0 → 0.12），按分钟取样会把那个
    // 轴拐点误读成曲率跳变 —— 那是轴画的，不是曲线画的。
    const minuteAt = (target: number): number => {
      let lo = 0
      let hi = 1440
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (curve.x(mid) < target) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    }
    const dx = 3
    const from = curve.x(960) + dx
    const to = CURVE_WIDTH - dx
    const samples = Array.from({ length: 30 }, (_, i) => {
      const at = from + ((to - from) * i) / 29
      return curve.y(minuteAt(at + dx)) - curve.y(minuteAt(at - dx))
    })
    const peak = samples.indexOf(Math.max(...samples))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(samples.length - 1)
    for (let i = 1; i <= peak; i++) expect(samples[i]!).toBeGreaterThan(samples[i - 1]!)
    for (let i = peak + 1; i < samples.length; i++) expect(samples[i]!).toBeLessThan(samples[i - 1]!)
    // 二阶差分 = 曲率突变：坡中间插一个锚点，这里会跳十倍（0.022 对 0.002）
    const steps = samples.slice(1).map((v, i) => v - samples[i]!)
    const jumps = steps.slice(1).map((v, i) => Math.abs(v - steps[i]!))
    expect(Math.max(...jumps)).toBeLessThan(0.005)
  })
  it('不过冲：全天任何一刻都在峰线与夜线之间（PCHIP 的单调限幅）', () => {
    const cases = [
      workday,
      { ...workday, peakWindows: [[540, 720]] as const },
      { ...workday, peakWindows: [[600, 610]] as const },
      { ...workday, peakWindows: [[540, 600], [900, 960]] as const },
      { ...workday, peakWindows: [[540, 900], [600, 700]] as const },
      { ...workday, peakWindows: [[0, 60], [1380, 1440]] as const },
      { ...workday, peakWindows: [[60, 200], [400, 1000], [1200, 1260]] as const },
    ]
    for (const profile of cases) {
      const curve = miniCurve(profile)
      for (let minute = 0; minute <= 1440; minute += 1) {
        expect(curve.y(minute)).toBeGreaterThanOrEqual(MINI_PEAK)
        expect(curve.y(minute)).toBeLessThanOrEqual(MINI_VALLEY)
      }
    }
  })
  it('峰窗内不再是平的：窗口两端只到肩部，顶点只有一个', () => {
    const curve = miniCurve(workday)
    const peak = curve.y(630)
    // 09:00 还高出峰顶 2 个单位（2.3px）、12:00 已经开始往下走 —— 窗口两端都不是顶
    expect(curve.y(540) - peak).toBeGreaterThan(2)
    expect(curve.y(720)).toBeGreaterThan(peak + 3)
    // 窗口正中才是顶：两侧都比它低
    expect(curve.y(600)).toBeGreaterThan(peak)
    expect(curve.y(660)).toBeGreaterThan(peak)
  })
  it('上午小峰、下午大峰：靠高度分大小，比例就是参考那条路线的 10 : 16', () => {
    const curve = miniCurve(workday)
    expect(curve.y(630)).toBe(MINI_SUB_PEAK)
    expect(curve.y(960)).toBe(MINI_PEAK)
    // 不是靠宽度：小峰量到起点（参考里 5.5−3）、大峰量到波谷（参考里 7.5−3.5）
    expect(MINI_RAMP - curve.y(630)).toBe(10)
    expect(MINI_SADDLE - curve.y(960)).toBe(16)
  })
  it('色带按档位判、不按高度：小峰不在峰线上，仍然算高峰色', () => {
    const curve = miniCurve(workday)
    const toneOf = (minute: number): string | undefined =>
      curve.tones.find((t) => Math.abs(t.offset * CURVE_WIDTH - curve.x(minute)) < 0.001)?.tone
    // 小峰停在自己的高度（12）上，不是峰线（4）—— 用 y === peakY 判就会把它判成谷
    expect(curve.points.find((p) => p.minute === 630)?.y).toBe(MINI_SUB_PEAK)
    expect(toneOf(630)).toBe('peak')
    expect(toneOf(960)).toBe('peak')
    expect(toneOf(780)).toBe('valley')
    expect(toneOf(0)).toBe('valley')
  })
  it('色带切点 = 折点 ∪ 峰窗两端：最后一个峰之后落回谷色，琥珀不许糊到夜里', () => {
    const curve = miniCurve(workday)
    expect(curve.tones.map((t) => Math.round(t.offset * CURVE_WIDTH))).toEqual(
      [0, 540, 630, 720, 780, 840, 960, 1080, 1440].map((m) => Math.round(curve.x(m))),
    )
    // 18:00 到 24:00 之间一个峰色切点都没有 —— 下坡合并成一段后，这段边界只能由窗口端点提供
    const tail = curve.tones.filter((t) => t.offset * CURVE_WIDTH > curve.x(1080) + 0.001)
    expect(tail.map((t) => t.tone)).toEqual(['valley'])
  })
  it('纵向铺满：峰谷行程占画布的 73%（照搬大图那套边距只剩 55%）', () => {
    expect((MINI_VALLEY - MINI_PEAK) / MINI_CURVE_HEIGHT).toBeCloseTo(22 / 30, 10)
    expect((MINI_VALLEY - MINI_PEAK) / MINI_CURVE_HEIGHT).toBeGreaterThan(0.7)
    expect((33 - 9) / CURVE_HEIGHT).toBeLessThan(0.56)
  })
  it('指针落在峰谷之间，并且顺着曲线走', () => {
    const curve = miniCurve(workday)
    for (const minute of [0, 300, 540, 630, 720, 780, 960, 1200, 1439]) {
      expect(curve.y(minute)).toBeGreaterThanOrEqual(MINI_PEAK)
      expect(curve.y(minute)).toBeLessThanOrEqual(MINI_VALLEY)
    }
    expect(curve.y(780)).toBeGreaterThan(curve.y(630)) // 中午的鞍比上午的顶低
  })
  it('面积收在 MINI_CURVE_HEIGHT 的下沿，不是大图的 44', () => {
    expect(miniCurve(workday).area).toContain(`L${CURVE_WIDTH},${MINI_CURVE_HEIGHT}L0,${MINI_CURVE_HEIGHT}Z`)
  })
  it('与大图同轴：两张形状的横坐标逐点相同（分歧只在纵轴）', () => {
    const big = tierCurve(workday)
    const mini = miniCurve(workday)
    for (const minute of [0, 450, 630, 780, 960, 1170, 1440]) {
      expect(mini.x(minute)).toBe(big.x(minute))
    }
  })
  it('与大图刻意不同形：大图的 09-12 是平顶，mini 的同一段是圆顶', () => {
    expect(tierCurve(workday).y(600)).toBe(tierCurve(workday).y(660)) // 大图：平
    expect(miniCurve(workday).y(600)).not.toBe(miniCurve(workday).y(660)) // mini：不平
  })
  it('两个峰窗的焦点区重叠时，鞍仍落在两窗正中间（不被区间端点顶到 13:30）', () => {
    expect(miniCurve(workday).points.find((p) => p.minute === 780)?.y).toBe(MINI_SADDLE)
  })
  it('两个峰窗隔得远时中间补一个波谷，否则那一段会退化成直线', () => {
    // 两个 1 小时的窗隔了 300 分钟，中间必须补一个波谷，否则那一段会退化成直线
    const apart = miniCurve({ ...workday, peakWindows: [[540, 600], [900, 960]] })
    expect(apart.points.map((p) => p.minute)).toEqual([0, 570, 750, 930, 1440])
    expect(apart.points.map((p) => p.y)).toEqual([
      MINI_RAMP, MINI_SUB_PEAK, MINI_SADDLE, MINI_PEAK, MINI_VALLEY,
    ])
    expect(apart.line.match(/L/g)).toBeNull()
    expect(apart.line.match(/C/g)).toHaveLength(4)
  })
  it('三个峰从矮到高插值：第一个是小峰、最后一个是高峰，中间落在两者之间', () => {
    const three = miniCurve({ ...workday, peakWindows: [[540, 600], [660, 720], [840, 1080]] })
    const at = (minute: number): number | undefined =>
      three.points.find((p) => p.minute === minute)?.y
    expect(at(570)).toBe(MINI_SUB_PEAK)
    expect(at(690)).toBe((MINI_SUB_PEAK + MINI_PEAK) / 2)
    expect(at(960)).toBe(MINI_PEAK)
  })
  it('单个峰窗一座大圆顶；非工作日没有形状可画，整条压在夜线上', () => {
    const single = miniCurve({ ...workday, peakWindows: [[540, 720]] })
    expect(single.points.map((p) => p.minute)).toEqual([0, 630, 1440])
    expect(single.points.map((p) => p.y)).toEqual([MINI_RAMP, MINI_PEAK, MINI_VALLEY])
    expect(single.line.match(/L/g)).toBeNull()
    // 周末是唯一的例外：那天确实全天同价，一条诚实的平线好过编出来的起伏
    const flat = miniCurve(weekend)
    expect(flat.points.map((p) => p.minute)).toEqual([0, 1440])
    expect(flat.points.every((p) => p.y === MINI_VALLEY)).toBe(true)
    expect(flat.tones.every((t) => t.tone === 'valley')).toBe(true)
    expect(flat.line).toBe(`M0,${MINI_VALLEY}L${CURVE_WIDTH},${MINI_VALLEY}`)
  })
  it('窄窗不塌：10 分钟的窗口仍是一个可画的圆顶', () => {
    const narrow = miniCurve({ ...workday, peakWindows: [[600, 610]] })
    expect(narrow.points.map((p) => p.y)).toEqual([MINI_RAMP, MINI_PEAK, MINI_VALLEY])
    const minutes = narrow.points.map((p) => p.minute)
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b))
    expect(minutes[0]).toBe(0)
    expect(minutes[minutes.length - 1]).toBe(1440)
  })
  it('第一个峰窗就压在 0 点上时不补起点：否则会在峰前面凭空挖一个假谷', () => {
    const midnight = miniCurve({ ...workday, peakWindows: [[0, 60], [1380, 1440]] })
    // 0 点本身就在峰窗里 → 起点那一格让给夜角，线从角落起、直接上峰
    expect(midnight.points[0]).toMatchObject({ minute: 0, y: MINI_VALLEY })
    expect(midnight.points[1]).toMatchObject({ minute: 30, y: MINI_SUB_PEAK })
  })
  it('峰窗互相重叠这种退化配置也不炸：点列仍单调、高度仍在口径内', () => {
    const overlap = miniCurve({ ...workday, peakWindows: [[540, 900], [600, 700]] })
    const minutes = overlap.points.map((p) => p.minute)
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b))
    for (const y of overlap.points.map((p) => p.y)) {
      expect(y).toBeGreaterThanOrEqual(MINI_PEAK)
      expect(y).toBeLessThanOrEqual(MINI_VALLEY)
    }
    expect(overlap.points.length).toBeGreaterThan(2)
    expect(overlap.line.startsWith(`M0,${MINI_RAMP}`)).toBe(true)
  })
})

describe('色带与判档口径与宿主一致（只看窗口，不看斜坡）', () => {
  it('色带切在窗口端点：坡上是渐变，平顶是纯峰色', () => {
    const curve = tierCurve(workday)
    const peakOffsets = curve.tones
      .filter((t) => t.tone === 'peak')
      .map((t) => Math.round(t.offset * CURVE_WIDTH))
    expect(peakOffsets).toEqual([540, 720, 840, 1080].map((minute) => Math.round(curve.x(minute))))
    expect(curve.tones[0]).toEqual({ offset: 0, tone: 'valley' })
    expect(curve.tones[curve.tones.length - 1]).toEqual({ offset: 1, tone: 'valley' })
  })
  it('窗口左闭右开', () => {
    expect(toneAtMinute(workday, 539)).toBe('valley')
    expect(toneAtMinute(workday, 540)).toBe('peak')
    expect(toneAtMinute(workday, 719)).toBe('peak')
    expect(toneAtMinute(workday, 720)).toBe('valley')
    expect(toneAtMinute(workday, 840)).toBe('peak')
    expect(toneAtMinute(workday, 1080)).toBe('valley')
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
