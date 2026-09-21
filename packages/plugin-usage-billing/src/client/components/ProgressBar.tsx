/**
 * 预算进度条 —— 侧栏入口卡与概览页**共用同一件**。
 *
 * 这里刻意只做两件事：把比例夹到 [0,1]（超支时条不能溢出容器）、把档位翻成
 * `data-level`。颜色不在组件里写死 —— 由样式表的 [data-level] 规则决定，
 * 主题切换 / 调色都不用改组件。
 */
import { barRatio } from '../core/budget-display.ts'
import type { BudgetState } from '../../budget.ts'
import styles from '../styles/settings-section.module.css'

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
      className={props.className === undefined ? styles.bar : styles.bar + ' ' + props.className}
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
