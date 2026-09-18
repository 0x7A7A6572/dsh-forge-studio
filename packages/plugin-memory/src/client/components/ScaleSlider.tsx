/**
 * 节点滑杆（ScaleSlider）：原生 range + 自绘轨道/滑块 + 一档一停的节点。
 *
 * 从「重要性」那一套抽出来，供重要性、注入门槛与 capture 高级配置共用 ——
 * 档位是离散值数组（steps），滑块位置是**档位下标**而不是数值本身，
 * 这样 1-5 的等级与 1-20 的间隔能用同一个组件、同一种手感和同一条 CSS。
 */

import type { CSSProperties, ReactNode } from 'react'

export interface ScaleSliderProps {
  /** 控件名，同时作为 aria-label。 */
  label: string
  /** 当前值（应当是 steps 中的一项）。 */
  value: number
  /** 可选档位，升序。 */
  steps: readonly number[]
  onChange: (value: number) => void
  disabled?: boolean
  /** 档位下方的一句话说明，返回节点以便加粗当前档名。 */
  describe?: (value: number) => ReactNode
  /** 读屏用的当前档文本；缺省报数值本身。 */
  valueText?: (value: number) => string
}

export function ScaleSlider(props: ScaleSliderProps) {
  const steps = props.steps.length > 0 ? props.steps : [props.value]
  const raw = steps.indexOf(props.value)
  const index = raw >= 0 ? raw : 0
  const current = steps[index] ?? props.value
  const fill = steps.length > 1 ? (index / (steps.length - 1)) * 100 : 100
  const desc = props.describe?.(current)
  return (
    <div className="mem-slider-wrap">
      <input
        type="range"
        className="mem-slider"
        min={0}
        max={steps.length - 1}
        step={1}
        value={index}
        disabled={props.disabled === true}
        aria-label={props.label}
        aria-valuetext={props.valueText?.(current) ?? String(current)}
        style={{ '--mem-fill': fill + '%' } as CSSProperties}
        onChange={(event) => {
          const next = steps[Number(event.currentTarget.value)]
          if (next !== undefined) props.onChange(next)
        }}
      />
      <div className="mem-slider-ticks" aria-hidden="true">
        {steps.map((step, at) => (
          <span key={step} className={at <= index ? 'mem-tick mem-tick-on' : 'mem-tick'} />
        ))}
      </div>
      {desc !== undefined && <span className="mem-slider-desc">{desc}</span>}
    </div>
  )
}
