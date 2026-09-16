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
  // 档位从 BUDGET_TIERS 推导：边界用 >=（恰好 50/80/100 命中 1/2/3，49.99 为 0）。
  const reached = BUDGET_TIERS.filter((tier) => pct >= tier).length as 0 | 1 | 2 | 3
  const level = reached === 3 ? 'over' : reached === 2 ? 'warn' : 'ok'
  // 脏值容错：非数字会解析成 NaN，而 `reached > NaN` 恒为 false，一条坏记录就会静默吞掉整月提醒。
  const parsed = Number(notified[monthKey] ?? '0')
  const last = Number.isFinite(parsed) ? parsed : 0
  const shouldNotify = reached > last && reached > 0 ? (reached as 1 | 2 | 3) : null
  return { pct, tier: reached, shouldNotify, level }
}
