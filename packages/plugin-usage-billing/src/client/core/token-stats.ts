/**
 * Token 口径的统计（纯函数）：累计 / 今日 / 时间窗切分。
 *
 * 为什么 Token 与金额分开算：金额有「未定价 = 未知」的问题（见 client/core/format.ts 的
 * isUnpricedTotal），Token 没有 —— token 是**观测事实**，永远精确。所以概览页的主数字
 * 走 Token（与参考版式一致），金额作为并列的次级信息出现，占位规则照旧。
 */

import type { DailyPoint } from '../../view.ts'

export interface TokenTotals {
  input: number; cacheRead: number; cacheWrite: number; output: number; calls: number; costCny: number
}

/** 总 Token = 未命中输入 + 缓存读 + 缓存写 + 输出（与趋势页、分模型表同一口径）。 */
export function totalTokens(
  t: Pick<TokenTotals, 'input' | 'cacheRead' | 'cacheWrite' | 'output'>,
): number {
  return t.input + t.cacheRead + t.cacheWrite + t.output
}

export function sumDays(days: readonly DailyPoint[]): TokenTotals {
  const out: TokenTotals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, costCny: 0 }
  for (const d of days) {
    out.input += d.input
    out.cacheRead += d.cacheRead
    out.cacheWrite += d.cacheWrite
    out.output += d.output
    out.calls += d.calls
    out.costCny += d.costCny
  }
  return out
}

/**
 * 缓存命中率 = cacheRead / (input + cacheRead)。
 * 与 view.ts 的 buildOverview 同一个式子：分母不含 cacheWrite（写缓存不是「读命中」），
 * 分母为 0 时返回 0 而不是 NaN。
 */
export function cacheHitRate(t: Pick<TokenTotals, 'input' | 'cacheRead'>): number {
  const denom = t.input + t.cacheRead
  return denom > 0 ? t.cacheRead / denom : 0
}

/** 'YYYY-MM-DD' → UTC 毫秒（用 UTC 做日期算术，本地时区遇到夏令时会算成 23/25 小时）。 */
function toMs(day: string): number | null {
  const [y, m, d] = day.split('-').map(Number)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  return Date.UTC(y, m - 1, d)
}

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** 日期加减（天）。解析失败时原样返回：宁可显示原值，也不要伪造一个「今天」。 */
export function addDays(day: string, delta: number): string {
  const base = toMs(day)
  if (base === null) return day
  return toDay(base + delta * 86_400_000)
}

/** 时间窗起点：结束日往前推 weeks*7-1 天（首尾相加恰好 weeks 个整周）。 */
export function windowStart(endDay: string, weeks: number): string {
  return addDays(endDay, -(weeks * 7 - 1))
}

/** 窗口长度上限：52 周是 364 天，留一倍余量挡住异常入参造成的长循环。 */
const MAX_WINDOW_DAYS = 800

/**
 * 把稀疏的按天数据补成**连续**日序列（缺的那天补 0）。
 * 热力图需要连续日历：只给有记录的日子，空格子会被 echarts 的 calendar 直接跳过。
 */
export function windowDays(
  days: readonly DailyPoint[],
  start: string,
  end: string,
): DailyPoint[] {
  const from = toMs(start)
  const to = toMs(end)
  if (from === null || to === null || to < from) return []
  const span = Math.floor((to - from) / 86_400_000) + 1
  if (span > MAX_WINDOW_DAYS) return []
  const byDay = new Map(days.map((d) => [d.day, d]))
  const out: DailyPoint[] = []
  for (let i = 0; i < span; i += 1) {
    const day = toDay(from + i * 86_400_000)
    out.push(byDay.get(day) ?? { day, costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 })
  }
  return out
}

/** 活跃度热力图可选的窗口（周）。 */
export const HEAT_WINDOWS = [12, 21, 52] as const
export type HeatWeeks = (typeof HEAT_WINDOWS)[number]

export const HEAT_WINDOW_LABEL: Record<HeatWeeks, string> = {
  12: '最近 12 周',
  21: '最近 21 周',
  52: '最近 52 周',
}

/** 窗口内有记录的天数。 */
export function activeDays(days: readonly DailyPoint[]): number {
  return days.filter((d) => d.calls > 0 || totalTokens(d) > 0 || d.costCny > 0).length
}

/** 最长连续有记录天数（按日期升序，遇到断档清零重计）。 */
export function longestStreak(days: readonly DailyPoint[]): number {
  let best = 0
  let run = 0
  for (const d of days) {
    if (d.calls > 0 || totalTokens(d) > 0 || d.costCny > 0) {
      run += 1
      if (run > best) best = run
    } else run = 0
  }
  return best
}
