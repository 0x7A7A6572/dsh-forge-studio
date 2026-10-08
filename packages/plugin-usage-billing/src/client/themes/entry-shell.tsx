/**
 * 内置入口主题的共享外壳：盒子观感、金额、预算条、失败徽标。
 * 中间那张图由主题传进来、宽态才放 —— 峰谷环 / 线条 M / 无 三个内置主题共用它。
 */
import type { ReactNode } from 'react'
import type { TierEntryProgress, TierEntryView } from '../../shape/index.ts'
import { PieBadge } from '../components/PieBadge.tsx'
import { barRatio } from '../core/budget-display.ts'
import styles from './entry-shell.module.css'

function StackBar(props: { progress: TierEntryProgress }): JSX.Element {
  const { progress } = props
  return (
    <span className={styles.bar} data-dsh-ub-stack-bar>
      <span
        className={styles.barUsed}
        data-level={progress.level}
        style={{ width: (barRatio(progress.ratio) * 100).toFixed(2) + '%' }}
      >
        {progress.bands.map((band) => (
          <span
            key={band.key}
            className={styles.barPiece}
            data-kind={band.key}
            // 今日跨所有项目，锚在已用段的右端；其余两段从左侧起。
            style={{
              ...(band.key === 'today' ? { right: 0 } : { left: 0 }),
              width: (barRatio(band.ratio) * 100).toFixed(2) + '%',
            }}
          />
        ))}
      </span>
    </span>
  )
}

export interface EntryShellProps {
  readonly themeId: string
  readonly view: TierEntryView
  readonly chart: ReactNode
}

/** 一张内置侧栏计费卡。主题把它整个返回，不需要再包一层。 */
export function EntryShell(props: EntryShellProps): JSX.Element {
  const { themeId, view, chart } = props
  const progress = view.progress
  const hasChart = chart !== null && chart !== undefined && chart !== false
  return (
    <span className={styles.card} data-wide={String(view.wide)} data-dsh-ub-theme={themeId}>
      {view.wide && hasChart ? <span className={styles.chart}>{chart}</span> : null}
      {view.wide ? null : (
        <span className={styles.icon} data-dsh-ub-icon aria-hidden="true">
          <PieBadge ratio={progress?.ratio ?? null} level={progress?.level ?? 'ok'} size={18} />
        </span>
      )}
      <span className={styles.text} data-dsh-ub-entry-text>
        <span className={styles.line}>
          <span className={styles.amount} data-dsh-ub-amount>
            <span className={styles.dot} data-kind="used" title="本月已用" aria-hidden="true" />
            {view.monthText}
          </span>
          <span className={styles.today} data-dsh-ub-today>
            <span className={styles.dot} data-kind="today" title="今日已用" aria-hidden="true" />
            {view.todayText}
          </span>
        </span>
        {progress === null ? null : (
          <span className={styles.budget} aria-hidden="true">
            <StackBar progress={progress} />
          </span>
        )}
      </span>
      {view.failed ? (
        <span className={styles.badge} data-dsh-ub-badge data-kind="error">
          读取失败
        </span>
      ) : null}
    </span>
  )
}
