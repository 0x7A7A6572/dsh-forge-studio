/**
 * 卡片：标题 + 右侧操作 + 说明段 + 内容。
 *
 * 为什么不是 primitives：那几个原语（Button / Input / Pill / Tag / Switch / Menu / Modal）
 * 覆盖的是**控件**，没有布局件；这里补的是布局件，控件一律仍走 primitives。
 *
 * 可折（`collapsible`）：长内容（活跃度图、分模型表、别名列表）默认收起来，卡头整行是
 * 折叠按钮 —— 开合状态**由调用方持有**（受控），因为折叠状态要活过「概览 / 趋势 / 明细」
 * 与页签的切换，而组件本身会被卸载重挂（同 DiscloseRow 的姿态）。
 * 收起时只留标题与右侧操作（`extra`）：右侧那个按钮往往就是这一块唯一的入口
 * （「添加别名」），把它一起藏掉会让卡片变成一条没有出口的标题。
 */
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from '../styles/settings-section.module.css'

export function Card(props: {
  title?: string
  /** 头部右侧（按钮 / 徽标）：可折卡片收起时仍然显示。 */
  extra?: ReactNode
  /** 卡片内的说明段。可折卡片收起时一并收起（它属于正文，不属于卡头）。 */
  desc?: string
  className?: string
  /** 允许只有卡头（标题 + 右侧操作）而没有正文：开关型的卡就是这种。 */
  children?: ReactNode
  /** 正文可折：需同时给 `open` 与 `onToggle`。 */
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
}): JSX.Element {
  const classNames = props.className === undefined ? styles.card : styles.card + ' ' + props.className
  const collapsible = props.collapsible === true
  const open = collapsible ? props.open === true : true
  const title = props.title === undefined ? null : collapsible ? (
    <button
      type="button"
      className={styles.cardToggle}
      aria-expanded={open}
      onClick={() => { props.onToggle?.() }}
    >
      <ChevronRight
        size={14}
        className={styles.chevron}
        data-open={open ? 'true' : undefined}
        aria-hidden="true"
      />
      <span className={styles.cardTitle}>{props.title}</span>
    </button>
  ) : (
    <span className={styles.cardTitle}>{props.title}</span>
  )
  return (
    <section className={classNames} data-collapsible={collapsible ? 'true' : undefined}>
      {props.title === undefined ? null : (
        <div className={styles.cardHead}>
          {title}
          {props.extra === undefined ? null : <div className={styles.cardActions}>{props.extra}</div>}
        </div>
      )}
      {open && props.desc !== undefined ? <p className={styles.rowDesc}>{props.desc}</p> : null}
      {open ? props.children : null}
    </section>
  )
}
