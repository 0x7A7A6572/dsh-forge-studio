/**
 * 侧栏入口卡（slot: sidebar.footer.action）—— lucide 图标 + 本月费用 + 今日 + 预算进度条。
 *
 * 预算进度条的颜色只由 `evaluateBudget` 的档位（ok / warn / over）决定，
 * 与概览页那条是同一个组件、同一份阈值。取数与文案见 hooks/useEntryCard.ts。
 */
import { Wallet } from 'lucide-react'
import { useEntryCard } from '../hooks/useEntryCard.ts'
import type { EntryCardProps } from '../hooks/useEntryCard.ts'
import { ProgressBar } from './ProgressBar.tsx'
import styles from '../styles/settings-section.module.css'

export function EntryCard(props: EntryCardProps): JSX.Element {
  const { load, failed, amountText, todayText, ariaLabel, togglePanel, budgetBar } = useEntryCard(props)

  return (
    <button
      type="button"
      data-dsh-usage-billing
      data-dsh-ub-entry
      data-wide={String(props.wide)}
      data-dsh-ub-state={load}
      className={styles.entry}
      title={failed ? '计费：数据读取失败（点击重试）' : '计费'}
      aria-label={ariaLabel}
      onClick={togglePanel}
    >
      <span className={styles.entryIcon} data-dsh-ub-icon aria-hidden="true">
        <Wallet size={16} />
      </span>
      <span className={styles.entryText} data-dsh-ub-entry-text>
        <span className={styles.entryLine}>
          <span className={styles.entryAmount} data-dsh-ub-amount>{amountText}</span>
          <span className={styles.entryToday} data-dsh-ub-today>今日 {todayText}</span>
        </span>
        {budgetBar === null ? null : (
          // 进度条在按钮里是纯装饰：它的口径已经在按钮的 aria-label 里说全了，
          // 留着 role=progressbar 只会让屏幕阅读器在按钮内部再念一遍。
          <span className={styles.entryBudget} aria-hidden="true">
            <ProgressBar level={budgetBar.level} ratio={budgetBar.ratio} thin label={budgetBar.label} />
            <span className={styles.entryPct}>{budgetBar.pctText}</span>
          </span>
        )}
      </span>
      {failed ? <span className={styles.badge} data-dsh-ub-badge data-kind="error">读取失败</span> : null}
    </button>
  )
}
