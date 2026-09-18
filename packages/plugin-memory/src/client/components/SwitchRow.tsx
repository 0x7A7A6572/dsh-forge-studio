/** 通用零件：一行开关（标题 + 说明 + 右侧 switch）。与记忆业务无关，故放 client/components/。 */

/** 一个开关行：标题 + 说明 + 右侧滑动开关（role=switch，键盘可达）。 */
export function SwitchRow(props: {
  title: string
  desc: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="mem-row">
      <div className="mem-row-copy">
        <span className="mem-row-title">{props.title}</span>
        <p className="mem-row-desc">{props.desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.title}
        disabled={props.disabled === true}
        className={props.checked ? 'mem-switch mem-switch-on' : 'mem-switch'}
        onClick={() => { props.onChange(!props.checked) }}
      >
        <span className="mem-switch-knob" />
      </button>
    </div>
  )
}
