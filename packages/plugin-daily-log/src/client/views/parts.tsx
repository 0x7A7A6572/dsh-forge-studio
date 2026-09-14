/**
 * 工作报告分区共用的小件：图标操作按钮、虚线新增位、渠道小标与几个格式化函数。
 * 组件只是宿主令牌的薄壳（样式在 views/ui-css.ts），页面各自组合。
 */

import type { ReactNode } from 'react'
import { CHANNEL_LABELS, NO_CHANNELS, SOURCE_KINDS } from '../../types.ts'
import type { ProjectChannels as ChannelMap, SourceType } from '../../types.ts'

/** 错误对象 → 可展示文本。 */
export function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

/** 项目类型显示名。 */
export const TYPE_LABELS: Record<SourceType, string> = {
  code: '代码项目',
  other: '其他',
}

/** 时间戳 → 本地 `YYYY-MM-DD HH:mm`。 */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 卡片页脚/行内的图标操作：几何与宿主图标按钮一致，标签走 data-tip 气泡 +
 * aria-label（纯图标按钮必须有无障碍名）。
 */
export function IconAction(props: {
  label: string
  icon: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={props.danger === true ? 'dl-icon-btn dl-icon-danger' : 'dl-icon-btn'}
      data-tip={props.label}
      aria-label={props.label}
      disabled={props.disabled === true}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  )
}

/** 虚线新增位（新增数据源 / 新增模板）：读作「之后会长出东西的位置」。 */
export function AddButton(props: {
  label: string
  icon?: ReactNode
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="dl-add"
      disabled={props.disabled === true}
      onClick={props.onClick}
    >
      {props.icon}
      {props.label}
    </button>
  )
}

/**
 * 弹窗内容包装层：Modal 是 body 级 portal，分区选择器在那里失配，所以包装层
 * 带上与设置分区同一个根标记 `data-dsh-dailylog-ui`，样式规则只写一份。
 */
export function DialogRoot(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="dl-dialog-body" data-dsh-dailylog-ui="">
      {props.children}
    </div>
  )
}

/** 渠道小标：Git / DSH / Claude / Codex，命中即亮，未命中压暗。 */
export function ChannelChips(props: { channels: ChannelMap | undefined }): JSX.Element {
  const ch = props.channels ?? NO_CHANNELS
  return (
    <span className="dl-chips">
      {SOURCE_KINDS.map((kind) => (
        <span
          key={kind}
          className={ch[kind] ? 'dl-chip dl-chip-on' : 'dl-chip'}
          title={CHANNEL_LABELS[kind] + (ch[kind] ? '：该路径下有活动' : '：该路径下暂无活动')}
        >
          {CHANNEL_LABELS[kind]}
        </span>
      ))}
    </span>
  )
}
