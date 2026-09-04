/**
 * 便签板设置弹窗：编辑 forge-studio-notes 命名空间的 defaultTitle。
 * 由便签板 header 齿轮按钮打开，替代原插件设置页卡片。
 * 读写直接走注入的 scope（settingsScope.bind 的命名空间 scope）：
 * - 空输入 = unset（回落到 base 默认值）；
 * - writable=false（只读镜像）时禁用编辑。
 */

import { useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotesConfig } from '../../types.ts'
import { t } from '../core/theme-tokens.ts'
import { X } from 'lucide-react'

export interface NotesSettingsDialogProps {
  /** forge-studio-notes 命名空间 scope（读写 defaultTitle）。 */
  readonly scope: SettingsScope<NotesConfig>
  /** 当前快照（用于展示当前值与覆盖态）。 */
  readonly snapshot: SettingsScopeSnapshot<NotesConfig>
  /** 保存失败回调（供上层展示错误条）。 */
  readonly onError?: (message: string) => void
  readonly onClose: () => void
}

export function NotesSettingsDialog(props: NotesSettingsDialogProps): JSX.Element {
  const current = props.snapshot.value?.defaultTitle ?? '新便签'
  const overridden =
    props.snapshot.user !== undefined && 'defaultTitle' in (props.snapshot.user as object)
  const writable = props.snapshot.writable
  const [draft, setDraft] = useState(current)
  const [saving, setSaving] = useState(false)
  const dirty = draft.trim() !== current

  async function save(): Promise<void> {
    if (!writable || !dirty || saving) return
    setSaving(true)
    try {
      const trimmed = draft.trim()
      if (trimmed === '') {
        await props.scope.unset('defaultTitle')
      } else {
        await props.scope.set('defaultTitle', trimmed)
      }
      props.onClose()
    } catch (cause) {
      props.onError?.(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={props.onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="便签板设置">
        <header style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 14, color: t.labelPrimary }}>便签板设置</span>
          <button type="button" title="关闭" aria-label="关闭" onClick={props.onClose} style={iconBtn}>
            <X size={14} />
          </button>
        </header>
        <label style={fieldStyle}>
          <span style={{ fontWeight: 600, fontSize: 13, color: t.labelPrimary }}>
            默认标题
            {overridden && <span style={{ color: t.stateWarn, fontSize: 12, marginLeft: 6 }}>已覆盖</span>}
          </span>
          <input
            value={draft}
            disabled={!writable || saving}
            placeholder="新便签"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
            style={inputStyle}
          />
          <span style={{ color: t.labelCaption, fontSize: 12 }}>新建便签标题留空时使用的默认标题；清空并保存可恢复系统默认</span>
        </label>
        <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={btnGhost} disabled={!writable || saving} onClick={props.onClose}>
            放弃
          </button>
          <button type="button" style={{ ...btnPrimary, ...(dirty && writable && !saving ? {} : dimmed) }}
            disabled={!writable || !dirty || saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ---------- 样式 ---------- */

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: t.mask,
}
const cardStyle: React.CSSProperties = {
  width: 'min(420px, 88%)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 14,
  background: t.surfaceRaised,
  border: `1px solid ${t.borderL2}`,
  borderRadius: 12,
  boxShadow: t.shadowLv3,
}
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}
const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  color: t.labelPrimary,
  background: 'transparent',
  border: `1px solid ${t.borderL2}`,
  borderRadius: 8,
  outline: 'none',
}
const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: t.labelSecondary,
  cursor: 'pointer',
}
const btnBase: React.CSSProperties = {
  height: 28,
  padding: '0 12px',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1,
  cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  ...btnBase,
  color: t.labelPrimary,
  background: 'transparent',
}
const btnPrimary: React.CSSProperties = {
  ...btnBase,
  color: t.onPrimary,
  background: t.primaryFill,
  fontWeight: 600,
}
const dimmed: React.CSSProperties = { opacity: 0.45, cursor: 'default' }
