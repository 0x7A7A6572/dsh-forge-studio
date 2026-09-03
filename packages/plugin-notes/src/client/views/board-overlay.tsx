/**
 * 便签板页面（shell.overlay 挂载点）：全屏遮罩 + 居中面板，数据直连 host。
 * 页面骨架职责：开关订阅、拉取/轮询、错误条、头部（标题/计数/刷新/关闭）、
 * 草稿编辑流（NoteEditor）与 busy 状态；内容区（工具栏/视图切换/颜色筛选/
 * 活动区/归档折叠区）全部委托给 BoardMain（views/board-main.tsx）。
 *
 * 视觉契约：纸卡是「便签纸」语义（固定 pastel 底 + 深色文字，见 note-colors）；
 * 其余 UI 走宿主 --dsw-* 令牌（见 theme-tokens）。
 * 遮罩层点击穿透（shell.overlay 契约），本组件根部显式开回 pointer events。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 载入 layout 的 SlotMap 增广（shell.overlay），type-only，无运行时依赖。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NoteColor, NoteRecord } from '../../types.ts'
import { boardStore } from '../core/board-store.ts'
import type { NotesRemote } from '../core/notes-remote.ts'
import { t } from '../core/theme-tokens.ts'
import { NoteEditor } from '../components/note-editor.tsx'
import { BoardMain } from './board-main.tsx'
import { RefreshCw, X } from 'lucide-react'

/** 浮层注入面（shell.overlay slot）。 */
export interface NotesBoardFace {
  readonly notes: NotesRemote
  readonly maxVisibleNotes?: number
  readonly defaultTitle: string
}

export type NotesBoardOverlayProps = PropsRuntime<'shell.overlay'> & InjectFace<NotesBoardFace>

type Draft = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly note: NoteRecord }

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 头部按钮 hover 与加载 spinner。 */
const OVERLAY_CSS = `
.fs-note-header-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
@keyframes fs-note-spin { to { transform: rotate(360deg); } }
.fs-note-spinner { border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-label-tertiary); border-radius: 50%; animation: fs-note-spin 0.8s linear infinite; }
`

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

  // Esc 关闭浮层（编辑态下 Esc 由编辑器处理并 stopPropagation，不会走到这里）。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') boardStore.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

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

  async function saveDraft(title: string, body: string, color: NoteColor): Promise<void> {
    if (!draft) return
    if (draft.mode === 'create') {
      const ok = await run(() => props.notes.create({ title, text: body, color }))
      if (ok) setDraft(undefined)
    } else {
      const ok = await run(() => props.notes.update(draft.note.id, { title, text: body, color }))
      if (ok) setDraft(undefined)
    }
  }

  const activeCount = notes.filter((n) => !n.archived).length

  return (
    <div style={backdropStyle} onClick={() => boardStore.hide()}>
      <style>{OVERLAY_CSS}</style>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="便签板">
        {!draft && (
          <header style={headerStyle}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={panelTitle}>便签板</span>
              <span style={countPill}>{activeCount}</span>
            </span>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {loading && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: t.labelCaption, fontSize: 12 }}>
                  <span className="fs-note-spinner" style={{ width: 12, height: 12 }} /> 加载中…
                </span>
              )}
              <button type="button" title="刷新" className="fs-note-header-btn" onClick={() => void refresh()} disabled={busy}
                style={{ ...iconBtn, ...(busy ? iconBtnDisabled : {}) }}>
                <RefreshCw size={15} />
              </button>
              <button type="button" title="关闭便签板" className="fs-note-header-btn" onClick={() => boardStore.hide()}
                style={iconBtn}>
                <X size={15} />
              </button>
            </span>
          </header>
        )}

        {error && (
          <div style={errorStrip}>
            <span style={{ flex: 1 }}>⚠ {error}</span>
            <button type="button" aria-label="关闭错误提示" style={{ ...iconBtn, color: 'inherit', width: 22, height: 22 }}
              onClick={() => setError(undefined)}>
              <X size={13} />
            </button>
          </div>
        )}

        {draft ? (
          <div style={{ padding: '4px 2px 0' }}>
            <NoteEditor
              key={draft.mode === 'edit' ? draft.note.id : 'create'}
              initialTitle={draft.mode === 'edit' ? draft.note.title : ''}
              initialBody={draft.mode === 'edit' ? draft.note.text : ''}
              initialColor={draft.mode === 'edit' ? draft.note.color : undefined}
              defaultTitle={props.defaultTitle}
              onCancel={() => setDraft(undefined)}
              onSave={saveDraft}
            />
          </div>
        ) : (
          <BoardMain
            notes={notes}
            busy={busy}
            maxVisibleNotes={props.maxVisibleNotes}
            onEdit={(note) => setDraft({ mode: 'edit', note })}
            onTogglePin={(note) => void run(() => props.notes.setPinned(note.id, !note.pinned))}
            onToggleArchive={(note) => void run(() => props.notes.update(note.id, { archived: !note.archived }))}
            onRemove={(note) => void run(() => props.notes.delete(note.id))}
            onCreate={() => setDraft({ mode: 'create' })}
          />
        )}
      </div>
    </div>
  )
}

/* ---------- 样式 ---------- */

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: t.mask,
  backdropFilter: t.maskBlur,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'auto',
  padding: 24,
  boxSizing: 'border-box',
}
const panelStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 860,
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  background: t.surface,
  border: `1px solid ${t.borderL2}`,
  borderRadius: 16,
  boxShadow: t.shadowLv3,
  overflow: 'hidden',
}
const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '14px 16px 10px',
  borderBottom: `1px solid ${t.borderL1}`,
}
const panelTitle: React.CSSProperties = { fontWeight: 600, fontSize: 15, color: t.labelPrimary }
const countPill: React.CSSProperties = {
  minWidth: 22,
  height: 20,
  padding: '0 7px',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  fontSize: 12,
  color: t.labelSecondary,
  background: t.hoverBg,
}
const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: t.labelSecondary,
  cursor: 'pointer',
}
const iconBtnDisabled: React.CSSProperties = { opacity: 0.45, cursor: 'default' }
const errorStrip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '10px 16px 0',
  padding: '7px 10px',
  borderRadius: 8,
  fontSize: 13,
  color: t.danger,
  background: t.hoverDangerBg,
}
