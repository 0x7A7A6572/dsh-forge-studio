/**
 * 峰谷判档与折算门禁。
 *
 * 背景：官方按两档计价（空闲 = 高峰 × 0.5），判档错一格就是金额错 ——
 * 窗口两端、周末、节假日、生效时间分段全部钉在这里，先红后绿。
 */
import { describe, expect, it } from 'vitest'
import {
  RULE_UTC_OFFSET_MINUTES, TIER_RULES, nextTierSwitchAt, tierAt, tierDayProfileAt, tierRuleAt,
} from '../packages/plugin-usage-billing/src/pricing/tiers.ts'
import { hasHolidayData, holidayStateAt } from '../packages/plugin-usage-billing/src/pricing/holidays.ts'
import { priceUsage } from '../packages/plugin-usage-billing/src/pricing/cost.ts'
import { foldEvents } from '../packages/plugin-usage-billing/src/fold.ts'
import type { FoldContext } from '../packages/plugin-usage-billing/src/fold.ts'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

/** 北京时间的某刻 → epoch ms（不依赖宿主时区）。 */
const bj = (y: number, mo: number, d: number, h: number, mi = 0): number => Date.UTC(y, mo - 1, d, h - 8, mi)
const noHoliday = (): boolean => false

describe('tierRuleAt：生效时间分段', () => {
  it('生效之前没有规则（= 单档，与今天等价）', () => {
    expect(tierRuleAt(bj(2026, 1, 5, 10))).toBeNull()
  })
  it('生效之后取到规则，边界那一刻即生效', () => {
    const since = TIER_RULES[0]!.since
    expect(tierRuleAt(since - 1)).toBeNull()
    expect(tierRuleAt(since)).toBe(TIER_RULES[0])
  })
})

describe('tierAt：时段判档（北京时间）', () => {
  it('高峰窗口左闭右开', () => {
    expect(tierAt(bj(2026, 9, 21, 9, 0), noHoliday)).toBe('peak')
    expect(tierAt(bj(2026, 9, 21, 11, 59), noHoliday)).toBe('peak')
    expect(tierAt(bj(2026, 9, 21, 12, 0), noHoliday)).toBe('offPeak')
    expect(tierAt(bj(2026, 9, 21, 14, 0), noHoliday)).toBe('peak')
    expect(tierAt(bj(2026, 9, 21, 17, 59), noHoliday)).toBe('peak')
    expect(tierAt(bj(2026, 9, 21, 18, 0), noHoliday)).toBe('offPeak')
  })
  it('工作日窗口之外为空闲', () => {
    expect(tierAt(bj(2026, 9, 21, 8, 59), noHoliday)).toBe('offPeak')
    expect(tierAt(bj(2026, 9, 21, 13, 59), noHoliday)).toBe('offPeak')
    expect(tierAt(bj(2026, 9, 21, 23, 0), noHoliday)).toBe('offPeak')
  })
  it('周末全天为空闲（含窗口内的周六 10:00）', () => {
    expect(tierAt(bj(2026, 9, 26, 10, 0), noHoliday)).toBe('offPeak')
    expect(tierAt(bj(2026, 9, 27, 15, 0), noHoliday)).toBe('offPeak')
  })
  it('法定节假日全天为空闲（含窗口内的周四 10:00）', () => {
    expect(tierAt(bj(2026, 10, 1, 10, 0), () => true)).toBe('offPeak')
  })
  it('规则生效之前一律高峰（单档）', () => {
    expect(tierAt(bj(2026, 8, 16, 10, 0), noHoliday)).toBe('peak')
    expect(tierAt(bj(2026, 8, 16, 10, 0), () => true)).toBe('peak')
  })
  it('固定 +08:00 换算（与宿主时区无关）', () => {
    const t = bj(2026, 9, 21, 10, 0)
    expect(new Date(t).toISOString()).toBe('2026-09-21T02:00:00.000Z')
    expect(tierAt(t, noHoliday)).toBe('peak')
  })
})


describe('节假日判定（tyme4ts，数据按年内嵌）', () => {
  it('法定节假日 → holiday（2026-10-01 国庆）', () => {
    expect(holidayStateAt(bj(2026, 10, 1, 10, 0))).toBe('holiday')
  })
  it('普通工作日 → normal', () => {
    expect(holidayStateAt(bj(2026, 9, 21, 10, 0))).toBe('normal')
  })
  it('调休上班日 → normal（isWork 不能当节假日）', () => {
    expect(holidayStateAt(bj(2026, 10, 10, 10, 0))).toBe('normal')
  })
  it('库没有该年数据 → unknown-year（不得当成「不是节假日」）', () => {
    expect(hasHolidayData(2026)).toBe(true)
    expect(hasHolidayData(2027)).toBe(false)
    expect(holidayStateAt(bj(2027, 1, 1, 10, 0))).toBe('unknown-year')
  })
  it('数据缺失的年份里，判档按高峰（保守，不低估）', () => {
    const isHoliday = (ms: number): boolean => holidayStateAt(ms) === 'holiday'
    expect(tierAt(bj(2027, 1, 5, 10, 0), isHoliday)).toBe('peak')
  })
})


const CNY_TABLE = { 'p/m': { input: 10, cacheRead: 1, cacheWrite: 10, output: 20, currency: 'CNY' as const } }
const FULL_USAGE = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }

describe('计价折算：空闲档按规则倍率打折', () => {
  it('四档单价同时折（含 cacheWrite）', () => {
    const peak = priceUsage(FULL_USAGE, CNY_TABLE, ['p/m'], 0)
    const off = priceUsage(FULL_USAGE, CNY_TABLE, ['p/m'], 0, 0.5)
    expect(peak.priced).toBe(true)
    expect(peak.costCny).toBeCloseTo(41, 10)
    expect(off.costCny).toBeCloseTo(20.5, 10)
  })
  it('不传系数与传 1 逐位一致（既有行为不变）', () => {
    expect(priceUsage(FULL_USAGE, CNY_TABLE, ['p/m'], 0).costCny).toBe(priceUsage(FULL_USAGE, CNY_TABLE, ['p/m'], 0, 1).costCny)
  })
  it('系数为 0 也不把已计价改成未计价', () => {
    const r = priceUsage(FULL_USAGE, CNY_TABLE, ['p/m'], 0, 0)
    expect(r.priced).toBe(true)
    expect(r.costCny).toBe(0)
    expect(r.matchedKey).toBe('p/m')
  })
  it('未收录与汇率不可用仍标未计价（与档位无关）', () => {
    expect(priceUsage(FULL_USAGE, CNY_TABLE, ['p/nope'], 0, 0.5).priced).toBe(false)
    const usd = { 'p/u': { input: 1, cacheRead: 0, cacheWrite: 1, output: 1, currency: 'USD' as const } }
    const r = priceUsage(FULL_USAGE, usd, ['p/u'], 0, 0.5)
    expect(r.priced).toBe(false)
    expect(r.matchedKey).toBe('p/u')
  })
})


const CATALOG = { 'deepseek/deepseek-v4-flash': { input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8, currency: 'CNY' as const } }
const ONE_M_IN = { inputTokens: 1_000_000, outputTokens: 0 }

const foldCtx = (installAt = 0): FoldContext => ({
  session: { id: 'session-tier' } as unknown as SessionHeader,
  installAt,
  aliases: new Map(),
  resolvePrice: () => ({ entries: CATALOG, usdToCny: 1, snapshotId: 'snap-tier' }),
})

/** 一条 request/context + 若干条带 usage 的 assistant/message。 */
const session = (times: number[]): SessionEvent[] => [
  { seq: 0, time: times[0]!, type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-v4-flash' } } as unknown as SessionEvent,
  ...times.map((time, i) => ({ seq: i + 1, time, type: 'assistant/message', data: { usage: ONE_M_IN } }) as unknown as SessionEvent),
]

describe('折叠接入：按事件时刻判档并写时锁定', () => {
  it('高峰 → 全额且行上记 peak', () => {
    const r = foldEvents(session([bj(2026, 9, 21, 10, 5)]), foldCtx())
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.tier).toBe('peak')
    expect(r.rows[0]!.costCny).toBeCloseTo(2, 10)
  })
  it('空闲 → 半价且行上记 offPeak', () => {
    const r = foldEvents(session([bj(2026, 9, 21, 13, 0)]), foldCtx())
    expect(r.rows[0]!.tier).toBe('offPeak')
    expect(r.rows[0]!.costCny).toBeCloseTo(1, 10)
  })
  it('同一会话两档共存，互不影响', () => {
    const r = foldEvents(session([bj(2026, 9, 21, 10, 5), bj(2026, 9, 21, 13, 0)]), foldCtx())
    expect(r.rows.map((x) => x.tier)).toEqual(['peak', 'offPeak'])
    expect(r.rows.map((x) => x.costCny)).toEqual([2, 1])
  })
  it('规则生效之前保持单档：不写 tier、按目录价', () => {
    const r = foldEvents(session([bj(2026, 8, 16, 10, 0)]), foldCtx())
    expect(r.rows[0]!.tier).toBeUndefined()
    expect(r.rows[0]!.costCny).toBeCloseTo(2, 10)
  })
  it('法定节假日（2026-10-01 国庆 10:05）按空闲', () => {
    const r = foldEvents(session([bj(2026, 10, 1, 10, 5)]), foldCtx())
    expect(r.rows[0]!.tier).toBe('offPeak')
    expect(r.rows[0]!.costCny).toBeCloseTo(1, 10)
  })
})


describe('下次切换时刻（回给界面用）', () => {
  it('高峰中 → 下一次窗口结束', () => {
    expect(nextTierSwitchAt(bj(2026, 9, 21, 10, 30), noHoliday)).toBe(bj(2026, 9, 21, 12, 0))
  })
  it('傍晚空闲 → 次个工作日窗口开始', () => {
    expect(nextTierSwitchAt(bj(2026, 9, 21, 19, 0), noHoliday)).toBe(bj(2026, 9, 22, 9, 0))
  })
  it('周五傍晚 → 跳过整个周末，到周一窗口开始', () => {
    expect(nextTierSwitchAt(bj(2026, 9, 25, 18, 30), noHoliday)).toBe(bj(2026, 9, 28, 9, 0))
  })
  it('规则生效之前 → 没有切换', () => {
    expect(nextTierSwitchAt(bj(2026, 8, 16, 10, 0), noHoliday)).toBeNull()
  })
})

describe('规则常量按官方口径', () => {
  it('两个窗口、仅工作日、倍率 0.5、节假日按 CN', () => {
    const rule = TIER_RULES[0]!
    expect(rule.peakWindows).toEqual([[540, 720], [840, 1080]])
    expect(rule.weekdaysOnly).toBe(true)
    expect(rule.offPeakRatio).toBe(0.5)
    expect(rule.holidays).toBe('CN')
  })
})


describe('今日费率形状（曲线的唯一数据源）', () => {
  it('工作日：窗口与倍率照规则给，横轴时区固定 +08:00', () => {
    const profile = tierDayProfileAt(bj(2026, 9, 21, 10, 0), noHoliday)!
    expect(profile.workday).toBe(true)
    expect(profile.peakWindows).toEqual([[540, 720], [840, 1080]])
    expect(profile.offPeakRatio).toBe(0.5)
    expect(profile.utcOffsetMinutes).toBe(480)
    expect(RULE_UTC_OFFSET_MINUTES).toBe(480)
  })
  it('周末：窗口为空（曲线压平），倍率照给（谷底还是半价）', () => {
    const profile = tierDayProfileAt(bj(2026, 9, 26, 10, 0), noHoliday)!
    expect(profile.workday).toBe(false)
    expect(profile.peakWindows).toEqual([])
    expect(profile.offPeakRatio).toBe(0.5)
  })
  it('法定节假日：窗口同样为空（含窗口内的周四 10:00）', () => {
    const profile = tierDayProfileAt(bj(2026, 10, 1, 10, 0), () => true)!
    expect(profile.workday).toBe(false)
    expect(profile.peakWindows).toEqual([])
  })
  it('规则生效之前没有形状可画（单档年代）', () => {
    expect(tierDayProfileAt(bj(2026, 1, 5, 10, 0), noHoliday)).toBeNull()
  })
  it('形状与判档同源：窗口为空 ⇔ 此刻判为空闲', () => {
    for (const [time, isHoliday] of [
      [bj(2026, 9, 26, 10, 0), noHoliday],   // 周六窗口内
      [bj(2026, 10, 1, 10, 0), () => true],  // 国庆窗口内
      [bj(2026, 9, 21, 10, 0), noHoliday],   // 工作日窗口内
    ] as const) {
      const profile = tierDayProfileAt(time, isHoliday)!
      const flat = profile.peakWindows.length === 0
      expect(flat).toBe(tierAt(time, isHoliday) === 'offPeak')
    }
  })
})
