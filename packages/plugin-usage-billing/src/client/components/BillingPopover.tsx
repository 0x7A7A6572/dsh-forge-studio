/** 计费明细面板，侧栏与输入框下方共用。位置与关闭交给 usePopoverSeat。 */
import { createPortal } from 'react-dom'
import { ProgressBar } from './ProgressBar.tsx'
import { TierCurve } from './TierCurve.tsx'
import { TodayStackBar } from './TodayStackBar.tsx'
import { MEASURE_STYLE } from '../hooks/usePopoverSeat.ts'
import type { PopoverSeat } from '../hooks/usePopoverSeat.ts'
import type { PopoverSegment } from '../hooks/useEntryCard.ts'
import type { TierDayProfile } from '../../pricing/tiers.ts'
import styles from '../styles/settings-section.module.css'

export interface BillingPopoverProps {
  seat: PopoverSeat
  /** `/ ¥预算` 是分母不是余额。 */
  headlineText: string
  /** `null` = 没开预算，不画进度条。 */
  budget: { level: 'ok' | 'warn' | 'over'; ratio: number } | null
  /** 累计：会话 / 本项目，不在任何条上。 */
  totalSegments: readonly PopoverSegment[]
  /** 顺序即颜色顺序。 */
  todaySegments: readonly PopoverSegment[]
  unpricedText: string | null
  /** `null` = 旧宿主或分时价未启用，整段不画。 */
  tierDay: TierDayProfile | null
  /** 与 `tierDay` 是两件事：这个是用户偏好，那个是有没有数据。 */
  showTierCurve: boolean
}

export function BillingPopover(props: BillingPopoverProps): JSX.Element | null {
  const seat = props.seat
  /** 两个判据都收敛成 null，渲染与 CSS 都只认它。 */
  const curve = props.tierDay !== null && props.showTierCurve ? props.tierDay : null
  if (!seat.open) return null
  return createPortal(
    <div
      className={styles.popover + ' ' + styles.palette}
      data-dsh-ub-popover
      data-tier-curve={curve === null ? 'off' : 'on'}
      ref={seat.panelRef}
      // 未测量时先隐藏：位置要等真实尺寸才夹得准。
      style={seat.pos ?? MEASURE_STYLE}
      role="dialog"
      aria-label="计费明细"
    >
      <div className={styles.popoverTitle}>
        <span className={styles.popoverHeadTerm}>
          <span className={styles.dot} data-kind="used" aria-hidden="true" />
          本月已用
        </span>
        <span className={styles.popoverValue}>{props.headlineText}</span>
      </div>
      <div className={styles.popoverRule} />

      {curve === null ? null : <TierCurve profile={curve} />}

      {props.budget === null ? (
        <dl className={styles.popoverDetails}>
          <div className={styles.popoverRow}>
            <dt className={styles.popoverTerm}>
              {/* 空心圈＝还没设预算。 */}
              <span className={styles.dot} data-kind="balance" aria-hidden="true" />
              预算
            </dt>
            <dd className={styles.popoverValue}>未设置</dd>
          </div>
        </dl>
      ) : (
        <div className={styles.popoverBudget}>
          {/* 读屏靠 label 读出本月已用。 */}
          <ProgressBar
            level={props.budget.level}
            ratio={props.budget.ratio}
            label={`本月已用 ${props.headlineText}`}
          />
        </div>
      )}

      <dl className={styles.popoverDetails}>
        <div className={styles.popoverRow}>
          <dt className={styles.popoverTerm}>累计</dt>
          <dd className={styles.popoverInline}>
            {props.totalSegments.map((s) => (
              <span key={s.key} className={styles.popoverChip}>
                <span className={styles.dot} data-kind={s.key} aria-hidden="true" />
                {s.label}
                <span className={styles.popoverValue}>{s.text}</span>
              </span>
            ))}
          </dd>
        </div>
      </dl>

      <div className={styles.popoverSection}>今日消耗分布</div>
      <div className={styles.popoverBudget}>
        <TodayStackBar segments={props.todaySegments} />
      </div>
      <dl className={styles.popoverDetails}>
        {props.todaySegments.map((s) => (
          <div key={s.key} className={styles.popoverRow}>
            <dt className={styles.popoverTerm}>
              {/* 只有条上真有一段才带色标。 */}
              {s.key === 'today' ? null : (
                <span className={styles.dot} data-kind={s.key} aria-hidden="true" />
              )}
              {s.label}
            </dt>
            <dd className={styles.popoverValue}>{s.text}</dd>
          </div>
        ))}
      </dl>

      {props.unpricedText === null ? null : (
        <p className={styles.popoverNote}>{props.unpricedText}</p>
      )}
    </div>,
    document.body,
  )
}
