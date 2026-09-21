/**
 * 开关行：标题 + 说明 + 右侧 Switch 原语（role=switch，键盘可达，可访问名必填）。
 * 与 plugin-memory 的 SwitchRow 同一姿态，只是控件换成原语而不是手写的 button。
 */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from '../styles/settings-section.module.css'

export function SwitchRow(props: {
  title: string
  desc: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <div className={styles.row}>
      <div className={styles.rowCopy}>
        <span className={styles.rowTitle}>{props.title}</span>
        <p className={styles.rowDesc}>{props.desc}</p>
      </div>
      <Switch
        checked={props.checked}
        disabled={props.disabled === true}
        label={props.title}
        onChange={props.onChange}
      />
    </div>
  )
}
