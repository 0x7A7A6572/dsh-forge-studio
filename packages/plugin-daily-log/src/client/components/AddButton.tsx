/** 虚线新增位（新增数据源 / 新增模板）：读作「之后会长出东西的位置」。 */
import type { ReactNode } from 'react'
import styles from '../styles/settings-section.module.css'

export function AddButton(props: {
  label: string
  icon?: ReactNode
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={styles.add}
      disabled={props.disabled === true}
      onClick={props.onClick}
    >
      {props.icon}
      {props.label}
    </button>
  )
}
