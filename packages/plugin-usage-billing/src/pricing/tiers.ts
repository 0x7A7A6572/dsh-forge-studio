/**
 * 峰谷时段规则与判档。
 *
 * 规则内置、带生效时间：厂商改时段只需加一条，判档代码不动。
 * 判档是纯计算，节假日由调用方注入 —— tyme4ts 只准出现在宿主侧。
 */

/** 计费档位。 */
export type Tier = 'peak' | 'offPeak'

export interface TierRule {
  /** 生效起点（epoch ms，含）。 */
  since: number
  /** 高峰窗口，北京时间的 [起始分钟, 结束分钟)，左闭右开。 */
  peakWindows: readonly (readonly [number, number])[]
  /** 仅周一至周五为高峰（官方口径）。 */
  weekdaysOnly: boolean
  /** 节假日来源；'CN' = 中国法定节假日全天算空闲。 */
  holidays: 'CN'
  /** 空闲档相对高峰档的倍率。 */
  offPeakRatio: number
}

const PEAK_WINDOWS = [[540, 720], [840, 1080]] as const

/**
 * 官方口径（2026-09-21 定价页）：工作日北京 09:00-12:00 / 14:00-18:00 为高峰；其余全天空闲，空闲价 = 高峰半价。
 * 起点取参考实现记录的政策变更点（北京 2026-08-17，官网未标日期）；更早的行按单档，宁可高估。
 */
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

/** 北京时间当日已过分钟数。 */
function beijingMinuteOfDay(timeMs: number): number {
  return Math.floor((((timeMs + CN_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60_000)
}

/** 北京时间的星期（0 = 周日）。 */
function beijingWeekday(timeMs: number): number {
  return new Date(timeMs + CN_OFFSET_MS).getUTCDay()
}

/** 取生效规则；没有就是单档计价的年代。 */
export function tierRuleAt(timeMs: number): TierRule | null {
  let hit: TierRule | null = null
  for (const rule of TIER_RULES) if (timeMs >= rule.since) hit = rule
  return hit
}

/**
 * 下一个档位切换时刻（界面提示用）。候选只有北京时间 00:00 与窗口端点：
 * 跨天才会变周末/节假日状态，所以不必逐分钟扫。
 * @returns 切换时刻；规则未生效或 8 天内不变则 null。
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

/** 一次拿到档位与折算系数；tier 为 null 表示此刻还没有生效规则（单档年代）。 */
export function tierAndFactorAt(
  timeMs: number,
  isHoliday: (timeMs: number) => boolean,
): { tier: Tier | null; factor: number } {
  const rule = tierRuleAt(timeMs)
  if (rule === null) return { tier: null, factor: 1 }
  const tier = tierAt(timeMs, isHoliday)
  return { tier, factor: tier === 'offPeak' ? rule.offPeakRatio : 1 }
}

/**
 * 判档。无生效规则 / 查不出节假日时一律按高峰 —— 宁可高估，不低估。
 */
export function tierAt(timeMs: number, isHoliday: (timeMs: number) => boolean): Tier {
  const rule = tierRuleAt(timeMs)
  if (rule === null) return 'peak'
  if (rule.weekdaysOnly) {
    const dow = beijingWeekday(timeMs)
    if (dow === 0 || dow === 6) return 'offPeak'
  }
  if (rule.holidays === 'CN' && isHoliday(timeMs)) return 'offPeak'
  const minute = beijingMinuteOfDay(timeMs)
  for (const [from, to] of rule.peakWindows) if (minute >= from && minute < to) return 'peak'
  return 'offPeak'
}
