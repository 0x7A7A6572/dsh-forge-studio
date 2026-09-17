/**
 * Hero 卡：一句标题 + 一个超大数字 + 若干等宽指标格（+ 可选脚注）。
 *
 * 版式对齐参考图里的「累计 / 今日」两张卡：标题左上小字灰色、主数字最大最重、
 * 指标格在下面对齐成列。金额这类有「未知」语义的值由调用方决定文案（这里只排版），
 * 所以卡片不接受金额规则 —— 占位逻辑只有 client/core/format.ts 一处。
 */

import type { ReactNode } from 'react'

export interface HeroCell {
  label: string
  value: ReactNode
}

export function HeroCard(props: {
  title: string
  /** 主数字（已格式化）。 */
  value: string
  /** 主数字右侧的单位说明。 */
  unit: string
  subtitle?: ReactNode
  cells: readonly HeroCell[]
  /** 脚注区（预算进度条等）。 */
  footnote?: ReactNode
}): JSX.Element {
  return (
    <section className="ub-herocard" data-dsh-ub-herocard>
      <div className="ub-herocard-title">{props.title}</div>
      <div className="ub-herocard-main">
        <span className="ub-herocard-value" data-dsh-ub-hero>{props.value}</span>
        <span className="ub-herocard-unit">{props.unit}</span>
      </div>
      {props.subtitle === undefined ? null : <div className="ub-herocard-sub">{props.subtitle}</div>}
      <div className="ub-herocard-cells">
        {props.cells.map((cell) => (
          // 上「大数字」下「文案」：DOM 顺序与视觉一致（读屏先念数值，再念它是什么）。
          <div className="ub-herocard-cell" key={cell.label}>
            <span className="ub-herocard-cell-value">{cell.value}</span>
            <span className="ub-herocard-cell-label">{cell.label}</span>
          </div>
        ))}
      </div>
      {props.footnote === undefined ? null : <div className="ub-herocard-foot">{props.footnote}</div>}
    </section>
  )
}
