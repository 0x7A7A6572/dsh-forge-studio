/**
 * 叠加预算条：整条 = 本月预算，已用段 = 本月已用（按档位着色），段内三段 = 本会话 /
 * 本项目 / 今日（长度在**已用段里**量：÷ 本月已用，不是拿整条预算当尺子）。
 *
 * 两个入口卡共用同一件；popup 里那两条（预算进度 / 今日分布）不是它 —— 那边没有叠放关系。
 * 这里只做几何与叠放顺序，颜色全在样式表的 [data-kind] / [data-level] 规则里。
 */
import { barRatio } from '../core/budget-display.ts'
import type { PopoverSegment } from '../hooks/useEntryCard.ts'
import type { BudgetState } from '../../budget.ts'
import styles from '../styles/settings-section.module.css'

/** 绘制顺序 = 叠放顺序（后画的在上）：本项目打底 → 今日从右端压上 → 当前会话在最上层。 */
const BAND_ORDER: ReadonlyArray<PopoverSegment['key']> = ['workspace', 'today', 'session']

/** 一段占「已用段」的百分比；未知按 0（不画这一段），超过已用则整段。 */
function bandPercent(value: number | null, spent: number): number {
  if (value === null || !Number.isFinite(value) || spent <= 0) return 0
  return Math.min(Math.max(value, 0) / spent, 1) * 100
}

export interface BudgetStackBarProps {
  /** `evaluateBudget` 给出的档位（唯一的阈值判据）。 */
  level: BudgetState['level']
  /** 已用比例（0.34 = 34%）；超 1 会夹到 1。 */
  ratio: number
  /** 本月已用金额（所有项目）：三段在已用段内按它换算长度。 */
  spentValue: number
  /** 三行指标（当前会话 / 本项目 / 今日）；侧栏用的是最近会话 / 最近项目。 */
  segments: readonly PopoverSegment[]
}

/** 纯装饰：数字在 popup 的三行与侧栏按钮的 aria-label 里，读屏不需要这段几何关系。 */
export function BudgetStackBar(props: BudgetStackBarProps): JSX.Element {
  const usedPercent = barRatio(props.ratio) * 100
  return (
    <span
      className={styles.segBar}
      data-dsh-ub-stack-bar
      aria-hidden="true"
    >
      {/* 已用段：三段都锚在它里面，超出不可能（三个数都是它的一部分）。 */}
      <span className={styles.segUsed} data-level={props.level} style={{ width: usedPercent.toFixed(2) + '%' }}>
        {BAND_ORDER.map((key) => {
          const segment = props.segments.find((s) => s.key === key)
          const percent = bandPercent(segment?.value ?? null, props.spentValue)
          if (segment === undefined || percent <= 0) return null
          // 今日锚在已用段右端（它跨所有项目），其余两段锚在左端。
          const anchor = key === 'today' ? { right: 0 } : { left: 0 }
          return (
            <span
              key={key}
              className={styles.segPiece}
              data-kind={key}
              style={{ ...anchor, width: percent.toFixed(2) + '%' }}
            />
          )
        })}
      </span>
    </span>
  )
}
