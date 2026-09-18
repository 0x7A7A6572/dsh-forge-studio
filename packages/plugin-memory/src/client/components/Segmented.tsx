import styles from '../styles/settings-section.module.css'
/** 通用零件：分段组按钮，替代短枚举的下拉。与记忆业务无关，故放 client/components/。 */

/** 分段组按钮：给「作用域 / 分类 / 重要性」这类短枚举用，替代下拉。 */
export function Segmented<T extends string | number>(props: {
  label: string
  value: T
  options: readonly { value: T; label: string; title?: string }[]
  disabled?: boolean
  onChange: (next: T) => void
}): JSX.Element {
  return (
    <div className={styles.segRow}>
      <span className={styles.segLabel}>{props.label}</span>
      <div className={styles.seg} role="radiogroup" aria-label={props.label}>
        {props.options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === props.value}
            title={option.title ?? option.label}
            disabled={props.disabled === true}
            className={option.value === props.value ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
            onClick={() => { props.onChange(option.value) }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
