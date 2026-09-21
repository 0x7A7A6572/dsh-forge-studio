/**
 * 计费 popup：点击计费入口后贴着它弹出的明细面板（侧栏与输入框下方共用同一个）。
 *
 * 版式照宿主自己的 popup（ui-chat 的 stat-dialog）：节标题左名右值 + 一条 0.5px 细线 +
 * 两列右对齐的 dt/dd。位置与关闭交给 usePopoverSeat（portal 到 body、夹在视口内），
 * 这里只管内容，所以组件是纯展示的、不持有状态。
 *
 * 标题值写成「本月已用 ¥已用 / ¥预算」：`/ ¥预算` 是**分母不是余额**。原先那行
 * 「预算余额 ¥473.95 / ¥600.00」会被下意识读成「已用 ¥473.95」，所以撤掉余额这一行 ——
 * 剩下的钱谁都能拿 600 减一下。
 */
import { createPortal } from 'react-dom'
import { BudgetStackBar } from './BudgetStackBar.tsx'
import { MEASURE_STYLE } from '../hooks/usePopoverSeat.ts'
import type { PopoverSeat } from '../hooks/usePopoverSeat.ts'
import type { PopoverSegment } from '../hooks/useEntryCard.ts'
import styles from '../styles/settings-section.module.css'

export interface BillingPopoverProps {
  seat: PopoverSeat
  /** 标题值：`本月已用 ¥已用 / ¥预算`（没开预算或整本账未定价时只有已用）。 */
  headlineText: string
  /** 三行指标（当前会话 / 本项目 / 今日），顺序即颜色顺序。 */
  segments: readonly PopoverSegment[]
  /** 未收录提醒；没有未收录模型时为 null。 */
  unpricedText: string | null
  /** 预算口径：只给画条要的三个数；没开预算时为 null。 */
  budget: {
    level: 'ok' | 'warn' | 'over'
    ratio: number
    /** 本月已用金额（所有项目）：三段在已用段内按它换算长度。 */
    spentValue: number
  } | null
}

export function BillingPopover(props: BillingPopoverProps): JSX.Element | null {
  const seat = props.seat
  if (!seat.open) return null
  return createPortal(
    <div
      className={styles.popover + ' ' + styles.palette}
      data-dsh-ub-popover
      ref={seat.panelRef}
      // 未测量时先隐藏参与布局：位置要等面板真实尺寸出来才夹得准。
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

      {props.budget === null ? (
        <dl className={styles.popoverDetails}>
          <div className={styles.popoverRow}>
            <dt className={styles.popoverTerm}>
              {/* 空心圈＝没用上的那部分：这里指「还没设预算」，与实心的已用段区分开。 */}
              <span className={styles.dot} data-kind="balance" aria-hidden="true" />
              预算
            </dt>
            <dd className={styles.popoverValue}>未设置</dd>
          </div>
        </dl>
      ) : (
        // 条上的已用段就是上面那个数：三层叠放（整条 = 预算 → 已用段 → 三段指标）。
        <div className={styles.popoverBudget}>
          <BudgetStackBar
            level={props.budget.level}
            ratio={props.budget.ratio}
            spentValue={props.budget.spentValue}
            segments={props.segments}
          />
        </div>
      )}

      <dl className={styles.popoverDetails}>
        {props.segments.map((s) => (
          <div key={s.key} className={styles.popoverRow}>
            <dt className={styles.popoverTerm}>
              <span className={styles.dot} data-kind={s.key} aria-hidden="true" />
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
