/**
 * 预算跨档提醒（设置页顶部）：跨 50 / 80 / 100% 各提醒一次。
 *
 * 「每个月份 + 档位只提醒一次」由已落盘的 notices.budgetNotified 保证，这里只负责显示与
 * 关闭本次提醒 —— 关闭不落盘，重开设置页也不会再提醒（标记在判定时就写了）。
 */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { BUDGET_TIERS } from '../../budget.ts'
import { formatPct } from '../core/format.ts'
import styles from '../styles/settings-section.module.css'

export function BudgetNotice(props: {
  tier: 1 | 2 | 3
  pct: number
  onDismiss: () => void
}): JSX.Element {
  return (
    <div
      className={styles.notice}
      data-dsh-usage-billing
      data-dsh-ub-budget-notice
      data-kind="warn"
      role="status"
    >
      <span>
        月度预算已用 {formatPct(props.pct, 0)}，跨过 {formatPct(BUDGET_TIERS[props.tier - 1], 0)} 档
        —— 每个「月份 + 档位」只提醒一次。
      </span>
      <div className={styles.noticeFoot}>
        <Button variant="ghost" size="sm" onClick={props.onDismiss}>知道了</Button>
      </div>
    </div>
  )
}
