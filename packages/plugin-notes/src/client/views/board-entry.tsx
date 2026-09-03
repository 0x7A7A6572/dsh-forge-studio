/**
 * 便签板入口（sidebar.footer.action 挂载点）：侧栏底部「设置」旁的按钮。
 * 点击开/关便签板浮层；wide=false（56px rail）时只显示图标。
 * 配色走宿主 --dsw-* 令牌；激活态（浮层开）图标呈品牌色。
 */

import { useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 载入 sidebar 的 SlotMap 增广（sidebar.footer.action），type-only，无运行时依赖。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { boardStore } from '../core/board-store.ts'
import { t } from '../core/theme-tokens.ts'
import { Bookmark } from 'lucide-react'

export type NotesBoardEntryProps = PropsRuntime<'sidebar.footer.action'>

const ENTRY_CSS = `
.fs-note-entry:hover { background: var(--dsw-alias-interactive-bg-hover); }
`

export function NotesBoardEntry(props: NotesBoardEntryProps): JSX.Element {
  const open = useSyncExternalStore(boardStore.subscribe, () => boardStore.open)
  return (
    <button
      className="fs-note-entry"
      onClick={() => boardStore.toggle()}
      title="便签"
      aria-pressed={open}
      style={{
        ...buttonStyle,
        ...(open ? { background: t.hoverBg } : {}),
        justifyContent: props.wide ? 'flex-start' : 'center',
      }}
    >
      <style>{ENTRY_CSS}</style>
      <Bookmark size={16} style={{ color: open ? t.pinAccent : undefined }} />
      {props.wide && <span>便签</span>}
    </button>
  )
}

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  color: t.labelPrimary,
  borderRadius: 8,
}
