/** 预算档位 → 展示文案 / 条宽比例（阈值判据只有 budget.ts 一处，这里只做呈现换算）。 */
import type { BudgetState } from '../../budget.ts'

/** 已用比例 → 条宽比例：非有限值 / 负数一律 0，超 100% 夹到 100%（条不能长过容器）。 */
export function barRatio(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0
  return pct >= 1 ? 1 : pct
}

/** 档位 → 一眼可读的文案（提醒文案与无障碍名共用，只此一处）。 */
export const BUDGET_LEVEL_LABEL: Record<BudgetState['level'], string> = {
  ok: '预算内',
  warn: '接近预算',
  over: '已超预算',
}
