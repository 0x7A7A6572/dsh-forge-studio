/**
 * 便签板浮层（shell.overlay 挂载点）：全屏半透明遮罩 + 居中面板。
 * 数据直连 host（ctx.remote.notes.*），与对话完全解耦：
 * - 打开时拉取、每次变更后刷新、打开期间每 5s 轮询（agent 工具变更也能跟上）；
 * - 新建/编辑用 tiptap 编辑器；置顶排前、更新时间降序，受设置上限裁剪。
 * 遮罩层是点击穿透的（shell.overlay 契约），本组件根部显式开回 pointer events。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 载入 layout 的 SlotMap 增广（shell.overlay），type-only，无运行时依赖。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NoteId, NoteRecord } from '../types.ts'
import { boardStore } from './board-store.ts'
import { NoteEditor } from './note-editor.tsx'
import type { NotesRemote } from './notes-remote.ts'

/** 浮层注入面（shell.overlay slot）。 */
export interface NotesBoardFace {
  readonly notes: NotesRemote
  readonly maxVisibleNotes?: number
  readonly defaultTitle: string
}

export type NotesBoardOverlayProps = PropsRuntime<'shell.overlay'> & InjectFace<NotesBoardFace>

type Draft = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly note: NoteRecord }

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function NotesBoardOverlay(props: NotesBoardOverlayProps): JSX.Element | null {
  const open = useSyncExternalStore(boardStore.subscribe, () => boardStore.open)
  const [notes, setNotes] = useState<readonly NoteRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [draft, setDraft] = useState<Draft | undefined>()
  const [busy, setBusy] = useState(false)

  async function refresh(silent = false): Promise<void> {
    if (!silent) setLoading(true)
    const result = await props.notes.list()
    if (result.ok) {
      setNotes(result.value)
      setError(undefined)
    } else if (!silent) {
      setError(errText(result.error))
    }
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = setInterval(() => void refresh(true), 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // hooks 必须在任何提前 return 之前调用（关闭时 notes 为空数组，开销可忽略）。
  const rows = useMemo(() => {
    const max = props.maxVisibleNotes ?? notes.length
    return [...notes]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
      .slice(0, max)
  }, [notes, props.maxVisibleNotes])

  if (!open) return null

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError(undefined)
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'ok' in result) {
        const outcome = result as { ok: boolean; error?: { message?: string } }
        if (!outcome.ok) {
          setError(outcome.error?.message ?? '操作失败')
          return false
        }
      }
      await refresh(true)
      return true
    } catch (cause) {
      setError(errText(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft(title: string, body: string): Promise<void> {
    if (!draft) return
    if (draft.mode === 'create') {
      const ok = await run(() => props.notes.create({ title, text: body }))
      if (ok) setDraft(undefined)
    } else {
      const ok = await run(() => props.notes.update(draft.note.id, { title, text: body }))
      if (ok) setDraft(undefined)
    }
  }

  return (
    <div style={backdropStyle} onClick={() => boardStore.hide()}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="便签板">
        <header style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>便签板（{notes.length}）</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {loading && <span style={{ color: '#999', fontSize: 12 }}>加载中…</span>}
            <button onClick={() => boardStore.hide()}>关闭</button>
          </span>
        </header>

        {error && <p style={errorStyle}>⚠ {error}</p>}

        {draft ? (
          <NoteEditor
            key={draft.mode === 'edit' ? draft.note.id : 'create'}
            initialTitle={draft.mode === 'edit' ? draft.note.title : ''}
            initialBody={draft.mode === 'edit' ? draft.note.text : ''}
            defaultTitle={props.defaultTitle}
            onCancel={() => setDraft(undefined)}
            onSave={saveDraft}
          />
        ) : (
          <>
            <div style={toolbarStyle}>
              <button onClick={() => setDraft({ mode: 'create' })} disabled={busy}>
                ＋ 新建便签
              </button>
            </div>
            {notes.length === 0 ? (
              <p style={{ color: '#888', margin: '8px 0' }}>暂无便签。点「＋ 新建便签」记一条，或让助手用 notes_create 工具创建。</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {rows.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    busy={busy}
                    onEdit={() => setDraft({ mode: 'edit', note })}
                    onTogglePin={() => void run(() => props.notes.setPinned(note.id, !note.pinned))}
                    onRemove={() => void run(() => props.notes.delete(note.id))}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface NoteRowProps {
  readonly note: NoteRecord
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onTogglePin: () => void
  readonly onRemove: () => void
}

function NoteRow(props: NoteRowProps): JSX.Element {
  const { note } = props
  return (
    <li style={rowStyle}>
      <span style={{ width: 16, textAlign: 'center' }}>{note.pinned ? '📌' : '·'}</span>
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
        {note.title || '（无标题）'}
      </span>
      <span style={snippetStyle}>{note.text.replace(/\s+/g, ' ').slice(0, 80)}</span>
      <span style={timeStyle}>{fmtTime(note.updatedAt)}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        <button onClick={props.onEdit} disabled={props.busy}>
          编辑
        </button>
        <button onClick={props.onTogglePin} disabled={props.busy}>
          {note.pinned ? '取消置顶' : '置顶'}
        </button>
        <button onClick={props.onRemove} disabled={props.busy}>
          删除
        </button>
      </span>
    </li>
  )
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(0, 0, 0, 0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'auto',
  padding: 24,
  boxSizing: 'border-box',
}
const panelStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 760,
  maxHeight: '82vh',
  overflow: 'auto',
  background: '#fff',
  borderRadius: 10,
  boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  boxSizing: 'border-box',
}
const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: '1px solid #eee',
  paddingBottom: 8,
}
const toolbarStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end' }
const errorStyle: React.CSSProperties = { color: '#b3261e', margin: 0, fontSize: 13 }
const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid #f3f3f3',
}
const snippetStyle: React.CSSProperties = {
  color: '#666',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
}
const timeStyle: React.CSSProperties = { color: '#999', fontSize: 12, whiteSpace: 'nowrap' }
