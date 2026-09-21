/**
 * 弹窗内容包装层：Modal 是 body 级 portal，分区选择器在那里失配，所以包装层
 * 带上与设置分区同一个根标记 `data-dsh-dailylog-ui`，样式规则只写一份。
 */
import type { ReactNode } from 'react'
import styles from '../styles/settings-section.module.css'

export function DialogRoot(props: { children: ReactNode }): JSX.Element {
  return (
    <div className={styles.dialogBody} data-dsh-dailylog-ui="">
      {props.children}
    </div>
  )
}
