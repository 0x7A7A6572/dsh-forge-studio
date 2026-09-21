/** 统计卡：一个数字 + 一句标签（概览 / 热力图 / 设置页共用）。 */
import type { ReactNode } from 'react'
import styles from '../styles/settings-section.module.css'

export function StatCard(props: {
  label: string
  value: ReactNode
  hint?: ReactNode
}): JSX.Element {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{props.label}</span>
      <span className={styles.statValue}>{props.value}</span>
      {props.hint === undefined ? null : <span className={styles.statHint}>{props.hint}</span>}
    </div>
  )
}
