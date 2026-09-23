/**
 * 计费 popup：点击计费入口后贴着它弹出的明细面板（侧栏与输入框下方共用同一个）。
 *
 * 版式照宿主自己的 popup（ui-chat 的 stat-dialog）：节标题左名右值 + 一条 0.5px 细线 +
 * 两列右对齐的 dt/dd。位置与关闭交给 usePopoverSeat（portal 到 body、夹在视口内），
 * 这里只管内容，所以组件是纯展示的、不持有状态。
 *
 * 三个时间轴各说各的（别混）：
 * - **本月**：标题值 + 一条预算进度（整条 = 本月总额度，填充 = 本月已用）。没设预算时整行不画，
 *   只在明细里写一句「预算 未设置」—— 没有分母就没有进度可言，画一条满格只会骗人。
 * - **累计（不区分时间）**：会话与项目的历史总额，只是两个数、不进任何条 —— 它们跟今天没有
 *   包含关系，塞进下面的分布条会溢出。
 * - **今日**：分布条（整条 = 今日合计）分段说明今天的钱花在本项目还是别处。
 *
 * 标题值写成「本月已用 ¥已用 / ¥预算」：`/ ¥预算` 是**分母不是余额**。原先那行
 * 「预算余额 ¥473.95 / ¥600.00」会被下意识读成「已用 ¥473.95」，所以撤掉余额这一行 ——
 * 剩下的钱谁都能拿 600 减一下。
 */
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
  /** 标题值：`本月已用 ¥已用 / ¥预算`（没开预算或整本账未定价时只有已用）。 */
  headlineText: string
  /** 预算进度要的两个数；没开预算时为 null —— 整条不画，只在明细里写「未设置」。 */
  budget: { level: 'ok' | 'warn' | 'over'; ratio: number } | null
  /** 累计（不区分时间）：当前会话累计 / 本项目累计；这两行不在任何条上。 */
  totalSegments: readonly PopoverSegment[]
  /** 今日消耗分布：本项目今日 / 其他项目今日 / 今日合计，顺序即颜色顺序。 */
  todaySegments: readonly PopoverSegment[]
  /** 未收录提醒；没有未收录模型时为 null。 */
  unpricedText: string | null
  /** 今日费率形状（峰谷曲线的数据源）；旧宿主 / 分时价未启用时为 null —— 整段不画。 */
  tierDay: TierDayProfile | null
  /**
   * 是否画峰谷时段图（设置里的 `display.showTierCurve`，默认开）。
   * **与 `tierDay` 是两件事**：这个是用户的显示偏好，那个是「有没有形状数据」——
   * 关掉开关不等于旧宿主。判据分开传，只在渲染处合并。
   */
  showTierCurve: boolean
}

export function BillingPopover(props: BillingPopoverProps): JSX.Element | null {
  const seat = props.seat
  /**
   * 真正要画的形状：**显示偏好关掉**（设置里的 `display.showTierCurve`）与**没有形状数据**
   * （旧宿主 / 分时价未启用）都收敛成 null。判据只写这一处，渲染与面板宽度（CSS
   * `.popover[data-tier-curve="off"]` 的回退）都只认这一个值。
   */
  const curve = props.tierDay !== null && props.showTierCurve ? props.tierDay : null
  if (!seat.open) return null
  return createPortal(
    <div
      className={styles.popover + ' ' + styles.palette}
      data-dsh-ub-popover
      data-tier-curve={curve === null ? 'off' : 'on'}
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

      {/* 紧跟标题：先说「此刻多少钱」，再给一张「此刻是什么档」的费率形状（设置里可关）。 */}
      {curve === null ? null : <TierCurve profile={curve} />}

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
        <div className={styles.popoverBudget}>
          {/* 条是纯视觉的：读屏靠 label 读出「本月已用多少」，与标题值是同一个数、同一个口径。 */}
          <ProgressBar
            level={props.budget.level}
            ratio={props.budget.ratio}
            label={`本月已用 ${props.headlineText}`}
          />
        </div>
      )}

      {/* 累计两个数并成一行：它们都不在条上，各占一行只会把 popup 拉长。 */}
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
              {/* 只有「条上真有一段」的指标带色标；今日合计是整条本身，给个色标会被对成琥珀那段。 */}
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
