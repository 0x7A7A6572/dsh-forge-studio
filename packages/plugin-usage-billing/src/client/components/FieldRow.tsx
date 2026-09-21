/**
 * 表单行：标签 + 控件 + 尾注。
 *
 * 根节点必须是真 `<label>`：按钮/开关之外的表单控件要靠它拿到可访问名，
 * 否则屏幕阅读器只会念「编辑框」。**传了 `note` 时不要再按它取 labelText** ——
 * 尾注的文字会并入 label 文本（要精确匹配的地方就别传 note）。
 */
import type { ReactNode } from 'react'
import styles from '../styles/settings-section.module.css'

export function FieldRow(props: {
  label: string
  /** 行尾的补充说明。 */
  note?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{props.label}</span>
      {props.children}
      {props.note === undefined ? null : <span className={styles.fieldNote}>{props.note}</span>}
    </label>
  )
}
