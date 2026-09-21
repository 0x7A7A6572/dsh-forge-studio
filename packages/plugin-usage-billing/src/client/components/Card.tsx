/**
 * 卡片：标题 + 右侧操作 + 说明段 + 内容。
 *
 * 为什么不是 primitives：那几个原语（Button / Input / Pill / Tag / Switch / Menu / Modal）
 * 覆盖的是**控件**，没有布局件；这里补的是布局件，控件一律仍走 primitives。
 */
import type { ReactNode } from 'react'
import styles from '../styles/settings-section.module.css'

export function Card(props: {
  title?: string
  /** 头部右侧（按钮 / 徽标）。 */
  extra?: ReactNode
  /** 卡片内的说明段。 */
  desc?: string
  className?: string
  /** 允许只有卡头（标题 + 右侧操作）而没有正文：开关型的卡就是这种。 */
  children?: ReactNode
}): JSX.Element {
  const cls = props.className === undefined ? styles.card : styles.card + ' ' + props.className
  return (
    <section className={cls}>
      {props.title === undefined ? null : (
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>{props.title}</span>
          {props.extra === undefined ? null : <div className={styles.cardActions}>{props.extra}</div>}
        </div>
      )}
      {props.desc === undefined ? null : <p className={styles.rowDesc}>{props.desc}</p>}
      {props.children === undefined ? null : props.children}
    </section>
  )
}
