/**
 * M 型费率带的几何门禁（纯函数，不渲染）。
 *
 * 形状本身就是需求，四条都要成立：
 * - **横轴是注意力轴**：峰窗 ±90 分钟按 1:1 展开，之外的深夜压到 0.12 —— 0-6 点、21-24 点
 *   只占很小一截，整条线是 `_M_` 而不是 `___M____`；指针、「现在」共用同一个映射。
 * - **纵轴只有两级**：两个峰（9-12 / 14-18）在峰线、其余在谷线。平顶就是峰窗本身
 *   （价在那个区间是平的），起伏只发生在窗口两侧。
 * - **坡是圆肩不是折角**：坡宽 = 窗口长度的一半（90 / 120 分钟），smoothstep 两端斜率为 0 ——
 *   整条线读起来是一道平滑的 `m`。相邻两窗之间那两条相对的坡等比压到吃满间距，
 *   谷底正好落在两窗之间，不会被糊成一个平肩。
 * - 指针永远落在曲线上；判档口径必须与宿主一致（只看窗口，不看斜坡）。
 */
import { describe, expect, it } from 'vitest'
import {
  CURVE_HEIGHT, CURVE_WIDTH, clockText, curveAriaLabel, curveTitleText, nowText, tierCurve,
  toneAtMinute,
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
