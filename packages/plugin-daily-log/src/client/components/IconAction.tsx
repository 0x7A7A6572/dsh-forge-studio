/**
 * 卡片页脚 / 行内的图标操作：标签走 data-tip 气泡 + aria-label
 * （纯图标按钮必须有无障碍名）。
 */
import type { ReactNode } from 'react'
import styles from '../styles/settings-section.module.css'

export function IconAction(props: {
  label: string
  icon: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  const cls = props.danger === true ? styles.iconBtn + ' ' + styles.iconDanger : styles.iconBtn
  return (
    <button
      type="button"
      className={cls}
      data-tip={props.label}
      aria-label={props.label}
      disabled={props.disabled === true}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  )
}
