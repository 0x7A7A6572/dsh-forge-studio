/**
 * 预算进度条 —— 侧栏入口卡与概览页**共用同一件**。
 *
 * 这里刻意只做两件事：把比例夹到 [0,1]（超支时条不能溢出容器）、把档位翻成
 * `data-level`。颜色不在这里写死 —— 由 ui-css.ts 的
 * `.ub-bar[data-level='warn'|'over']` 决定，主题切换 / 调色都不用改组件。
 *
 * 档位来自 `budget.ts` 的 `evaluateBudget`（唯一的档位判据），本组件不重复实现阈值。
 */

import type { BudgetState } from '../../../budget.ts'

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

export interface ProgressBarProps {
  /** `evaluateBudget` 给出的档位（唯一的阈值判据）。 */
  level: BudgetState['level']
  /** 已用比例（0.34 = 34%）；超 1 会夹到 1。 */
  ratio: number
  /** 无障碍名：进度条是纯视觉的，屏幕阅读器要靠它读出「已用 34%」。 */
  label: string
  /** 侧栏用的 4px 细条。 */
  thin?: boolean
  className?: string
}

export function ProgressBar(props: ProgressBarProps): JSX.Element {
  const ratio = barRatio(props.ratio)
  return (
    <span
      className={props.className === undefined ? 'ub-bar' : 'ub-bar ' + props.className}
      data-dsh-ub-bar
      data-level={props.level}
      data-thin={props.thin === true ? 'true' : undefined}
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
    >
      <i style={{ width: (ratio * 100).toFixed(2) + '%' }} />
    </span>
  )
}
