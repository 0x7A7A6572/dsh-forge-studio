/**
 * 输入框下方的计费入口（slot: conversation.composer.dock）。
 *
 * 本体只有「一个小小的饼图 + 当前会话金额」：这一行是宿主的会话统计胶囊，字比侧栏小、
 * 挨着一排同类控件，多一个数字都会变成噪音；明细全部收进点击后的 popup。
 * 饼图画的是本月预算已用比例（没有预算口径时只有底环），所以它读的是与侧栏同一份数据。
 */
import { useEntryCard } from '../hooks/useEntryCard.ts'
import type { EntryDataProps } from '../hooks/useEntryCard.ts'
import { useEntryVisible } from '../hooks/useEntryFlags.ts'
import type { BillingScope } from '../core/config.ts'
import { BillingPopover } from './BillingPopover.tsx'
import { PieBadge } from './PieBadge.tsx'
import styles from '../styles/settings-section.module.css'

export interface ComposerEntryProps extends EntryDataProps {
  scope: BillingScope
}

export function ComposerEntry(props: ComposerEntryProps): JSX.Element | null {
  const { load, sessionText, budgetBar, unpricedText, segments, seat, ...rest } = useEntryCard(props)
  const visible = useEntryVisible(props.scope, 'composer')
  // 关掉「输入框下方」这个入口时本组件不渲染：槽位留空，不占那一行的位置。
  if (!visible) return null

  return (
    <span className={styles.pillSeat + ' ' + styles.palette} ref={seat.anchorRef}>
      <button
        type="button"
        data-dsh-usage-billing
        data-dsh-ub-composer-entry
        data-dsh-ub-state={load}
        className={styles.pill}
        title="计费"
        aria-label={rest.ariaLabel}
        aria-expanded={seat.open}
        onClick={seat.toggle}
      >
        <PieBadge ratio={budgetBar?.ratio ?? null} level={budgetBar?.level ?? 'ok'} />
        <span className={styles.pillAmount} data-dsh-ub-session-money>{sessionText}</span>
      </button>
      <BillingPopover
        seat={seat}
        headlineText={rest.headlineText}
        segments={segments}
        unpricedText={unpricedText}
        budget={budgetBar}
      />
    </span>
  )
}
