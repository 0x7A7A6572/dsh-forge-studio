/**
 * 分段选择：范围 / 指标 / 落点这类「几档里选一个」。
 *
 * 宿主原语里没有分段控件（Pill 是胶囊标签、Switch 只有开与关），图表范围切换又必须
 * 并排摆开才好比较，所以自绘一个：容器一条细边 + 内衬，选中项浅底。单选语义按
 * `role="group"` + `aria-pressed` 报 —— 不引 radiogroup，方向键那套焦点行为要自己
 * 写一遍，收益不成比例。
 */
import styles from '../styles/settings-section.module.css'

/** 选项值可以是字符串（范围 / 指标）也可以是数字（活跃度周数），两者都能当 key。 */
export interface SegmentedOption<T extends string | number> {
  value: T
  label: string
}

export function SegmentedControl<T extends string | number>(props: {
  /** 可访问名（这组开关管的是什么）。 */
  label: string
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  disabled?: boolean
  onChange: (next: T) => void
}): JSX.Element {
  return (
    <div className={styles.seg} role="group" aria-label={props.label} data-dsh-ub-seg>
      {props.options.map((option) => {
        const active = option.value === props.value
        return (
          <button
            key={option.value}
            type="button"
            className={styles.segItem}
            data-active={active ? 'true' : undefined}
            aria-pressed={active}
            disabled={props.disabled === true}
            onClick={() => { props.onChange(option.value) }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
