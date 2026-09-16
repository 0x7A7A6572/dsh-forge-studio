/**
 * 卡片 / 统计卡 / 表单行 / 开关行 —— 本插件共用的版式件（视觉语言对齐 plugin-memory 的设置分区）。
 *
 * 为什么不是 primitives：那几个原语（Button / Input / Pill / Tag / Switch / Menu / Modal）
 * 覆盖的是**控件**，没有布局件；这里补的是布局件，控件一律仍走 primitives。
 */

import type { ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'

export function Card(props: {
  title?: string
  /** 头部右侧（按钮 / 徽标）。 */
  extra?: ReactNode
  /** 卡片内的说明段。 */
  desc?: string
  className?: string
  children: ReactNode
}): JSX.Element {
  const cls = props.className === undefined ? 'ub-card' : 'ub-card ' + props.className
  return (
    <section className={cls}>
      {props.title === undefined ? null : (
        <div className="ub-card-head">
          <span className="ub-card-title">{props.title}</span>
          {props.extra === undefined ? null : <div className="ub-card-actions">{props.extra}</div>}
        </div>
      )}
      {props.desc === undefined ? null : <p className="ub-row-desc">{props.desc}</p>}
      {props.children}
    </section>
  )
}

/** 统计卡：一个数字 + 一句标签（概览 / 热力图 / 设置页共用）。 */
export function StatCard(props: {
  label: string
  value: ReactNode
  hint?: ReactNode
}): JSX.Element {
  return (
    <div className="ub-stat">
      <span className="ub-stat-label">{props.label}</span>
      <span className="ub-stat-value">{props.value}</span>
      {props.hint === undefined ? null : <span className="ub-stat-hint">{props.hint}</span>}
    </div>
  )
}

/**
 * 表单行：标签 + 控件 + 尾注。
 *
 * 根节点必须是真 `<label>`：按钮/开关之外的表单控件要靠它拿到可访问名，
 * 否则屏幕阅读器只会念「编辑框」。**传了 `note` 时不要再按它取 labelText** ——
 * 尾注的文字会并入 label 文本（要精确匹配的地方就别传 note）。
 */
export function FieldRow(props: {
  label: string
  /** 行尾的补充说明。 */
  note?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="ub-field">
      <span className="ub-field-label">{props.label}</span>
      {props.children}
      {props.note === undefined ? null : <span className="ub-field-note">{props.note}</span>}
    </label>
  )
}

/**
 * 开关行：标题 + 说明 + 右侧 Switch 原语（role=switch，键盘可达，可访问名必填）。
 * 与 plugin-memory 的 SwitchRow 同一姿态，只是控件换成原语而不是手写的 button。
 */
export function SwitchRow(props: {
  title: string
  desc: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="ub-row">
      <div className="ub-row-copy">
        <span className="ub-row-title">{props.title}</span>
        <p className="ub-row-desc">{props.desc}</p>
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
