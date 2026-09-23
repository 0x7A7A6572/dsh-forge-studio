/**
 * M 型费率带的几何门禁（纯函数，不渲染）。
 *
 * 形状本身是需求：0→24 点一条平台曲线、两个峰（9-12 / 14-18）、峰谷之间是谷，
 * 峰谷边界由短坡过渡；指针永远落在曲线上。判档口径必须与宿主一致（只看窗口）。
 */
import { describe, expect, it } from 'vitest'
import {
  AXIS_TICKS, CURVE_HEIGHT, CURVE_WIDTH, areaPath, clockText, curveAriaLabel, curvePoints,
  curveTitleText, curveTones, curveYAt, linePath, nowText, toneAtMinute,
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

describe('曲线形状：0→24 点的平台 M', () => {
  it('折点顺序与窗口一一对应（坡宽 20 分钟）', () => {
    expect(curvePoints(workday).map((p) => p.minute)).toEqual([
      0, 520, 540, 700, 720, 820, 840, 1060, 1080, 1440,
    ])
  })
  it('只有两个高度：平台在峰线、其余在谷线', () => {
    const ys = curvePoints(workday).map((p) => p.y)
    expect(new Set(ys).size).toBe(2)
    const [valley, peak] = [Math.max(...ys), Math.min(...ys)]
    expect(ys.filter((y) => y === peak)).toHaveLength(4) // 两段平台各两个端点
    expect(curveYAt(curvePoints(workday), 600)).toBe(peak)  // 10:00 平台
    expect(curveYAt(curvePoints(workday), 900)).toBe(peak)  // 15:00 平台
    expect(curveYAt(curvePoints(workday), 780)).toBe(valley) // 13:00 谷
    expect(curveYAt(curvePoints(workday), 0)).toBe(valley)
    expect(curveYAt(curvePoints(workday), 1439)).toBe(valley)
  })
  it('过渡坡是斜线：坡中点落在两线之间', () => {
    const points = curvePoints(workday)
    const [valley, peak] = [curveYAt(points, 0), curveYAt(points, 600)]
    const mid = curveYAt(points, 530)
    expect(mid).toBeGreaterThan(peak)
    expect(mid).toBeLessThan(valley)
    expect(mid).toBeCloseTo((peak + valley) / 2, 10)
  })
  it('非工作日压平成一条谷线（起止两点都在同一高度）', () => {
    const points = curvePoints(weekend)
    expect(points.map((p) => p.y)).toEqual([33, 33])
    expect(curveYAt(points, 600)).toBe(curveYAt(points, 0))
    expect(curveTones(weekend).every((t) => t.tone === 'valley')).toBe(true)
  })
  it('窄窗不把过渡坡叠成负宽（最多各占半宽 → 坡宽 5 分钟）', () => {
    const narrow: TierDayProfile = { ...workday, peakWindows: [[600, 610]] }
    const points = curvePoints(narrow)
    expect(points.map((p) => p.minute)).toEqual([0, 595, 600, 605, 610, 1440])
    expect(points.map((p) => p.minute)).toEqual([...points.map((p) => p.minute)].sort((a, b) => a - b))
  })
  it('路径收尾闭合到 24:00 与下沿（面积不外溢）', () => {
    const points = curvePoints(workday)
    expect(linePath(points)).toMatch(/^M0,33L/)
    expect(areaPath(points)).toContain(`L${CURVE_WIDTH},${CURVE_HEIGHT}L0,${CURVE_HEIGHT}Z`)
  })
})

describe('判档口径与宿主一致（只看窗口，不看斜坡）', () => {
  it('窗口左闭右开', () => {
    expect(toneAtMinute(workday, 539)).toBe('valley')
    expect(toneAtMinute(workday, 540)).toBe('peak')
    expect(toneAtMinute(workday, 719)).toBe('peak')
    expect(toneAtMinute(workday, 720)).toBe('valley')
    expect(toneAtMinute(workday, 840)).toBe('peak')
    expect(toneAtMinute(workday, 1080)).toBe('valley')
  })
  it('色带切在窗口端点：坡上就已经换成峰色', () => {
    const tones = curveTones(workday)
    expect(tones[0]).toEqual({ offset: 0, tone: 'valley' })
    const peakOffsets = tones.filter((t) => t.tone === 'peak').map((t) => Math.round(t.offset * CURVE_WIDTH))
    expect(peakOffsets).toEqual([540, 700, 840, 1060])
    expect(tones[tones.length - 1]).toEqual({ offset: 1, tone: 'valley' })
  })
})

describe('文案', () => {
  it('刻度只有 0/6/12/18/24 点', () => {
    expect(AXIS_TICKS.map((t) => t / 60)).toEqual([0, 6, 12, 18, 24])
    expect(clockText(AXIS_TICKS[1]!)).toBe('06:00')
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
  })
  it('规则时区的当日分钟（本机时区无关）', () => {
    expect(ruleMinuteOfDay(Date.UTC(2026, 8, 21, 2, 32), 480)).toBe(632) // 北京 10:32
    expect(ruleMinuteOfDay(Date.UTC(2026, 8, 20, 23, 30), 480)).toBe(450) // 北京 07:30
  })
})
