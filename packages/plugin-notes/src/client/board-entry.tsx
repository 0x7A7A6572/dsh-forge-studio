/**
 * 便签板入口（sidebar.footer.action 挂载点）：侧栏底部「设置」旁的按钮。
 * 点击开/关便签板浮层；wide=false（56px rail）时只显示图标。
 */

import { useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 载入 sidebar 的 SlotMap 增广（sidebar.footer.action），type-only，无运行时依赖。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { boardStore } from './board-store.ts'

export type NotesBoardEntryProps = PropsRuntime<'sidebar.footer.action'>

export function NotesBoardEntry(props: NotesBoardEntryProps): JSX.Element {
  const open = useSyncExternalStore(boardStore.subscribe, () => boardStore.open)
  return (
    <button
      onClick={() => boardStore.toggle()}
      title="便签板"
      aria-pressed={open}
      style={{
        ...buttonStyle,
        ...(open ? activeStyle : {}),
        justifyContent: props.wide ? 'flex-start' : 'center',
      }}
    >
      <span aria-hidden>📌</span>
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
  color: 'inherit',
  borderRadius: 6,
}
const activeStyle: React.CSSProperties = { background: 'rgba(0, 0, 0, 0.08)' }
