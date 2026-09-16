/** 月度预算分档判定（纯函数）。跨 50/80/100% 各提醒一次，按「月份」去重。 */

export const BUDGET_TIERS = [0.5, 0.8, 1] as const

export interface BudgetState {
  pct: number
  tier: 0 | 1 | 2 | 3
  shouldNotify: 1 | 2 | 3 | null
  level: 'ok' | 'warn' | 'over'
}

export function evaluateBudget(input: {
  spentCny: number
  monthlyCny: number
  enabled: boolean
  notified: Readonly<Record<string, string>>
  monthKey: string
}): BudgetState {
  const { spentCny, monthlyCny, enabled, notified, monthKey } = input
  if (!enabled || monthlyCny <= 0) {
    return { pct: 0, tier: 0, shouldNotify: null, level: 'ok' }
  }
  const pct = spentCny / monthlyCny
  const reached: 0 | 1 | 2 | 3 = pct >= 1 ? 3 : pct >= 0.8 ? 2 : pct >= 0.5 ? 1 : 0
  const level = reached === 3 ? 'over' : reached === 2 ? 'warn' : 'ok'
  const last = Number(notified[monthKey] ?? '0')
  const shouldNotify = reached > last && reached > 0 ? (reached as 1 | 2 | 3) : null
  return { pct, tier: reached, shouldNotify, level }
}
