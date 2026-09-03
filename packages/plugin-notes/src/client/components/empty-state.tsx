/**
 * 便签板空状态：没有任何便签时的引导展示。
 */

import { FileText } from 'lucide-react'
import { t } from '../core/theme-tokens.ts'

export interface EmptyStateProps {
  readonly onCreate: () => void
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '48px 0', color: t.labelTertiary }}>
      <FileText size={38} style={{ opacity: 0.55 }} />
      <span style={{ color: t.labelSecondary, fontSize: 14, fontWeight: 500 }}>还没有便签</span>
      <span style={{ color: t.labelCaption, fontSize: 13, textAlign: 'center', maxWidth: 380 }}>
        点「新建便签」记一条；正文支持 Markdown，便签纸颜色可在编辑器底部设置。
      </span>
      <button type="button" style={newBtn} onClick={props.onCreate}>
        新建便签
      </button>
    </div>
  )
}

/* ---------- 样式 ---------- */

const newBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 30,
  padding: '0 14px',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1,
  cursor: 'pointer',
  color: t.onPrimary,
  background: t.primaryFill,
  fontWeight: 600,
  marginTop: 4,
}
