/**
 * 通用确认弹窗（ConfirmDialog）：给「有后果、动手前该问一句」的操作一个统一外壳。
 *
 * 外壳与 settings / help / editor 三个弹窗同构：同一套 .fs-note-overlay + .fs-note-dialog
 * （遮罩、圆角、投影、入场动画）与 theme-tokens 令牌，避免各写一份观感不同的「确认」。
 *
 * 用在编辑器弹窗**内部**时定位用 fixed：编辑器遮罩是 absolute + overflow:auto，
 * 嵌套的 absolute 遮罩会随内容滚动跑位（高弹窗滚到下面时遮罩就盖不住了）；fixed 覆盖
 * 视口，且仍在同一层叠上下文里，能把编辑器整层压住。
 *
 * 键盘与鼠标：Esc = 取消（捕获阶段吃掉，避免连带把外层编辑器弹窗也关掉）；
 * 点遮罩 = 取消；主按钮自动聚焦，回车即确认（所以「默认动作」= 主按钮，三选一时
 * 拿 extraLabel 补中间那个出口，别把主按钮让给次要动作）。
 */

import { useEffect } from 'react'
import { t } from '../core/theme-tokens.ts'
import styles from '../styles/notes-board.module.css'

export interface ConfirmDialogProps {
  /** 标题（同时作为无障碍名）。 */
  readonly title: string
  /** 一句话说清要发生什么。 */
  readonly description: string
  /** 后果要点，每行一条（可选）。 */
  readonly bullets?: readonly string[]
  /** 主按钮文案（写成动词短语，如「开启定时」）。 */
  readonly confirmLabel: string
  /** 次按钮文案，缺省「取消」。 */
  readonly cancelLabel?: string
  /**
   * 第三个动作（可选）：在「取消」与主按钮之间再给一个出口。有些操作是**三选一**
   * —— 关闭一张有改动的便签就是（保存并关闭 / 放弃改动 / 继续编辑），只有两个按钮时
   * 只能牺牲其中一个：要么「放弃」藏在「取消」里（用户以为取消了其实改了），
   * 要么干脆没法保存。给了 extraLabel 就必须给 onExtra（少一个按钮会渲染不出来）。
   */
  readonly extraLabel?: string
  readonly onExtra?: () => void
  /** 左侧强调色（便签纸色环）：把弹窗和它所属的那张便签认在一起。 */
  readonly accent?: string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const { onCancel } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 捕获阶段拦截：只关这一层，不让外层编辑器弹窗跟着关。
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className={styles.overlay} style={overlayStyle} onClick={onCancel}>
      <div
        className={styles.dialog}
        style={{ ...cardStyle, borderLeft: `4px solid ${props.accent ?? t.borderL2}` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <span style={titleStyle}>{props.title}</span>
        <p style={descriptionStyle}>{props.description}</p>
        {props.bullets !== undefined && props.bullets.length > 0 && (
          <ul style={listStyle}>
            {props.bullets.map((line) => (
              <li key={line} style={itemStyle}>
                <span
                  aria-hidden="true"
                  style={{ ...dotStyle, background: props.accent ?? t.labelTertiary }}
                />
                <span style={itemTextStyle}>{line}</span>
              </li>
            ))}
          </ul>
        )}
        <span style={actionsStyle}>
          <button type="button" style={btnGhost} onClick={onCancel}>
            {props.cancelLabel ?? '取消'}
          </button>
          {props.extraLabel !== undefined && props.onExtra !== undefined && (
            <button type="button" style={btnGhost} onClick={props.onExtra}>
              {props.extraLabel}
            </button>
          )}
          <button type="button" style={btnPrimary} autoFocus onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </span>
      </div>
    </div>
  )
}

/* ---------- 样式（令牌取色，明暗主题自动适配） ---------- */

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 20,
  display: 'flex',
  background: t.mask,
  padding: 16,
  boxSizing: 'border-box',
  overflow: 'auto',
}
const cardStyle: React.CSSProperties = {
  margin: 'auto',
  width: 'min(420px, 100%)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 16,
  background: t.surfaceRaised,
  border: `1px solid ${t.borderL2}`,
  borderRadius: 12,
  boxShadow: t.shadowLv3,
}
const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: t.labelPrimary,
}
const descriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  lineHeight: 1.65,
  color: t.labelSecondary,
}
const listStyle: React.CSSProperties = {
  margin: 0,
  padding: '2px 0 0',
  listStyle: 'none',
  display: 'grid',
  gap: 6,
}
const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 7,
}
const dotStyle: React.CSSProperties = {
  flex: 'none',
  width: 5,
  height: 5,
  marginTop: 6,
  borderRadius: 1,
  opacity: 0.75,
}
const itemTextStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
  color: t.labelSecondary,
}
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 2,
}
const btnBase: React.CSSProperties = {
  height: 28,
  padding: '0 12px',
  fontSize: 12,
  fontFamily: 'inherit',
  borderRadius: 8,
  cursor: 'pointer',
  border: 'none',
}
const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: t.primaryFill,
  color: t.onPrimary,
}
const btnGhost: React.CSSProperties = {
  ...btnBase,
  background: 'transparent',
  color: t.labelPrimary,
  border: `1px solid ${t.borderL2}`,
}
