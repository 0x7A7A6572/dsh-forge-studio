/**
 * 归档折叠区：默认收起（只显示「已归档 (N)」标题行），点击展开才渲染内容
 * （内容由 renderContent 惰性构建，收起时不产生 DOM/组件）。放在列表底部。
 * 受控组件：open/onToggle 由上层（board-main）持有 —— 上层需要知道展开态来
 * 驱动归档区的懒加载窗口（nextWindow 只在展开后补归档区）。
 */

import { Archive, ChevronRight } from 'lucide-react'
import { t } from '../core/theme-tokens.ts'

/** 标题行 hover/箭头旋转；展开内容淡入（fs-note-in 由 board-main 的 MOTION_CSS 注入）。 */
export const ARCHIVED_CSS = `
.fs-note-archived-toggle { transition: background 120ms ease; }
.fs-note-archived-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
.fs-note-archived-toggle:hover .fs-note-archived-chevron { transform: rotate(90deg); }
.fs-note-archived-chevron { transition: transform 140ms ease; }
.fs-note-archived-open .fs-note-archived-chevron { transform: rotate(90deg); }
.fs-note-archived-body { animation: fs-note-in 220ms ease-out backwards; }
`

export interface ArchivedSectionProps {
  /** 归档便签数量。 */
  readonly count: number
  /** 是否展开（受控）。 */
  readonly open: boolean
  readonly onToggle: () => void
  /** 惰性内容工厂：仅在展开时被调用。 */
  readonly renderContent: () => React.ReactNode
}

export function ArchivedSection(props: ArchivedSectionProps): JSX.Element {
  if (props.count <= 0) return <></>
  return (
    <section style={sectionStyle}>
      <button
        type="button"
        className={`fs-note-archived-toggle${props.open ? ' fs-note-archived-open' : ''}`}
        aria-expanded={props.open}
        onClick={props.onToggle}
        style={toggleStyle}
      >
        <Archive size={14} style={{ flex: 'none', color: t.labelSecondary }} />
        <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>已归档（{props.count}）</span>
        <ChevronRight size={14} className="fs-note-archived-chevron" style={{ flex: 'none', color: t.labelTertiary }} />
      </button>
      {props.open && <div className="fs-note-archived-body" style={contentStyle}>{props.renderContent()}</div>}
    </section>
  )
}

/* ---------- 样式 ---------- */

const sectionStyle: React.CSSProperties = {
  marginTop: 4,
  borderTop: `1px dashed ${t.borderL2}`,
  paddingTop: 6,
}
const toggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 12.5,
  color: t.labelSecondary,
  boxSizing: 'border-box',
}
const contentStyle: React.CSSProperties = {
  paddingTop: 8,
}
