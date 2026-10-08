/** 峰谷时段规则与判档；节假日由调用方注入（tyme4ts 只准出现在宿主侧）。 */

export type Tier = 'peak' | 'offPeak'

export interface TierRule {
  /** 生效起点（epoch ms，含）。 */
  since: number
  /** 高峰窗口，北京时间分钟，左闭右开。 */
  peakWindows: readonly (readonly [number, number])[]
  weekdaysOnly: boolean
  /** 'CN' = 中国法定节假日全天算空闲。 */
  holidays: 'CN'
  offPeakRatio: number
}

/** 今日费率形状；与判档共用同一份窗口，客户端只做几何。 */
export interface TierDayProfile {
  /** 工作日且非节假日；false 时 peakWindows 为空。 */
  workday: boolean
  peakWindows: readonly (readonly [number, number])[]
  offPeakRatio: number
  utcOffsetMinutes: number
}

const PEAK_WINDOWS = [[540, 720], [840, 1080]] as const

/** 起点取参考实现记录的政策变更点（北京 2026-08-17，官网未标日期）。 */
export const TIER_RULES: readonly TierRule[] = [
  {
    since: Date.UTC(2026, 7, 16, 16),
    peakWindows: PEAK_WINDOWS,
    weekdaysOnly: true,
    holidays: 'CN',
    offPeakRatio: 0.5,
  },
]

const DAY_MS = 86_400_000
const CN_OFFSET_MS = 8 * 3_600_000

/** 规则时区相对 UTC 的分钟偏移（北京 480）；曲线横轴用该时区的自然日。 */
export const RULE_UTC_OFFSET_MINUTES = CN_OFFSET_MS / 60_000

function beijingMinuteOfDay(timeMs: number): number {
  return Math.floor((((timeMs + CN_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60_000)
}

function beijingWeekday(timeMs: number): number {
  return new Date(timeMs + CN_OFFSET_MS).getUTCDay()
}

/** 生效规则；null = 该时刻属于单档年代。 */
export function tierRuleAt(timeMs: number): TierRule | null {
  let hit: TierRule | null = null
  for (const rule of TIER_RULES) if (timeMs >= rule.since) hit = rule
  return hit
}

/**
 * 下一个档位切换时刻。候选只有北京时间 00:00 与窗口端点。
 * @returns 规则未生效或 8 天内不变则 null。
 */
export function nextTierSwitchAt(now: number, isHoliday: (timeMs: number) => boolean): number | null {
  const rule = tierRuleAt(now)
  if (rule === null) return null
  const current = tierAt(now, isHoliday)
  const dayStart = Math.floor((now + CN_OFFSET_MS) / DAY_MS) * DAY_MS - CN_OFFSET_MS
  for (let i = 0; i < 8; i++) {
    const base = dayStart + i * DAY_MS
    const edges = rule.peakWindows.flatMap(([from, to]) => [base + from * 60_000, base + to * 60_000])
    for (const at of [base, ...edges].sort((a, b) => a - b)) {
      if (at <= now) continue
      if (tierAt(at, isHoliday) !== current) return at
    }
  }
  return null
}

export function tierAndFactorAt(
  timeMs: number,
  isHoliday: (timeMs: number) => boolean,
): { tier: Tier | null; factor: number } {
  const rule = tierRuleAt(timeMs)
  if (rule === null) return { tier: null, factor: 1 }
  const tier = tierAt(timeMs, isHoliday)
  return { tier, factor: tier === 'offPeak' ? rule.offPeakRatio : 1 }
}

function offDay(rule: TierRule, timeMs: number, isHoliday: (timeMs: number) => boolean): boolean {
  if (rule.weekdaysOnly) {
    const dow = beijingWeekday(timeMs)
    if (dow === 0 || dow === 6) return true
  }
  return rule.holidays === 'CN' && isHoliday(timeMs)
}

/** 无生效规则 / 查不出节假日时按高峰计。 */
export function tierAt(timeMs: number, isHoliday: (timeMs: number) => boolean): Tier {
  const rule = tierRuleAt(timeMs)
  if (rule === null) return 'peak'
  if (offDay(rule, timeMs, isHoliday)) return 'offPeak'
  const minute = beijingMinuteOfDay(timeMs)
  for (const [from, to] of rule.peakWindows) if (minute >= from && minute < to) return 'peak'
  return 'offPeak'
}

export function tierDayProfileAt(
  now: number,
  isHoliday: (timeMs: number) => boolean,
): TierDayProfile | null {
  const rule = tierRuleAt(now)
  if (rule === null) return null
  const workday = !offDay(rule, now, isHoliday)
  return {
    workday,
    peakWindows: workday ? rule.peakWindows : [],
    offPeakRatio: rule.offPeakRatio,
    utcOffsetMinutes: RULE_UTC_OFFSET_MINUTES,
  }
}
