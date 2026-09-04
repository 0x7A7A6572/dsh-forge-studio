/**
 * 泳道迷你纸卡（任务泳道列内卡片）：窄列专用压缩版便签纸 —— 仍保持
 * 「便签纸」语义（固定 pastel 底 + 深色文字），纸色由 note.color 决定。
 * - 整卡可拖（HTML5 DnD）：dragstart 写入 note.id，拖到目标列即换状态；
 * - hover 动作与 NoteCard 一致：编辑/置顶/归档或恢复/删除（不置顶时归档态
 *   同样只给恢复）；
 * - 点击/回车进入编辑器（换纸色即换状态的后备路径，取色器有键盘支持）。
 * 类选择器样式见导出的 LANE_CARD_CSS（由 board-main 统一注入一次 <style>）。
 */

import { useState } from 'react'
import type { NoteRecord } from '../../types.ts'
import { NOTE_INK, NOTE_INK_MUTED, noteColorMeta } from '../core/note-colors.ts'
import { mdSnippet } from '../core/markdown-text.ts'
import { fmtDateTime, fmtRelative } from '../core/time-text.ts'
import { Archive, ArchiveRestore, Pencil, Pin, Trash2 } from 'lucide-react'

/** 泳道卡 hover/焦点/拖拽态与两行截断。 */
export const LANE_CARD_CSS = `
.fs-lane-card { transition: box-shadow 140ms ease, transform 140ms ease; }
.fs-lane-card:hover { box-shadow: 0 8px 18px rgba(0, 0, 0, 0.16); transform: translateY(-1px); }
.fs-lane-card:focus-visible { outline: 2px solid rgba(0, 0, 0, 0.45); outline-offset: 1px; }
.fs-lane-card[draggable='true'] { cursor: grab; }
.fs-lane-card[draggable='true']:active { cursor: grabbing; }
.fs-lane-actions { opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.fs-lane-card:hover .fs-lane-actions, .fs-lane-card:focus-within .fs-lane-actions { opacity: 1; pointer-events: auto; }
.fs-lane-snippet { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.fs-lane-card .fs-lane-actions button { color: rgba(46, 42, 34, 0.55); }
.fs-lane-card .fs-lane-actions button:hover:not(:disabled) { background: rgba(0, 0, 0, 0.1); color: #2e2a22; }
.fs-lane-card .fs-lane-actions button[data-danger]:hover:not(:disabled) { background: rgba(197, 48, 48, 0.18); color: #b3261e; }
`

export interface TaskLaneCardProps {
  readonly note: NoteRecord
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onTogglePin: () => void
  readonly onToggleArchive: () => void
  readonly onRemove: () => void
}

export function TaskLaneCard(props: TaskLaneCardProps): JSX.Element {
  const { note } = props
  // 拖拽不可用/忙时禁用：避免执行中的更新与后续拖放竞争。
  const draggable = !props.busy && !note.archived
  const meta = noteColorMeta(note.color)
  const snippet = note.text ? mdSnippet(note.text, 100) : ''
  const [dragging, setDragging] = useState(false)

  return (
    <li>
      <div
        className="fs-lane-card"
        role="button"
        tabIndex={0}
        aria-label={note.archived
          ? `已归档：${note.title || '无标题'}`
          : note.pinned
            ? `置顶：${note.title || '无标题'}`
            : note.title || '无标题'}
        draggable={draggable}
        onDragStart={(e) => {
          setDragging(true)
          e.dataTransfer.setData('text/plain', note.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => setDragging(false)}
        onClick={props.onEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            props.onEdit()
          }
        }}
        style={{ ...cardStyle, background: meta.paper, opacity: dragging ? 0.45 : 1 }}
      >
        <span style={cardTitleRow}>
          <span style={cardTitle} title={note.title || '（无标题）'}>
            {note.title || <span style={{ color: NOTE_INK_MUTED }}>（无标题）</span>}
          </span>
          {note.pinned && !note.archived && <Pin size={12} style={{ flex: 'none', color: meta.ring }} aria-label="已置顶" />}
        </span>
        {snippet ? (
          <span className="fs-lane-snippet" style={{ ...cardSnippet, color: NOTE_INK_MUTED }}>{snippet}</span>
        ) : (
          <span style={{ ...cardSnippet, color: NOTE_INK_MUTED, fontStyle: 'italic' }}>（无正文）</span>
        )}
        <span style={cardFooter}>
          <time style={{ color: NOTE_INK_MUTED, fontSize: 10.5 }} title={fmtDateTime(note.updatedAt)}>{fmtRelative(note.updatedAt)}</time>
          <span className="fs-lane-actions" style={cardActions}>
            <button type="button" title="编辑" aria-label="编辑" disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onEdit() }} style={actionBtn}>
              <Pencil size={12} />
            </button>
            {!note.archived && (
              <button type="button" title={note.pinned ? '取消置顶' : '置顶'} aria-label={note.pinned ? '取消置顶' : '置顶'}
                disabled={props.busy}
                onClick={(e) => { e.stopPropagation(); props.onTogglePin() }}
                style={{ ...actionBtn, ...(note.pinned ? { color: meta.ring } : {}) }}>
                <Pin size={12} />
              </button>
            )}
            <button type="button"
              title={note.archived ? '恢复（取消归档）' : '归档'}
              aria-label={note.archived ? '恢复' : '归档'}
              disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onToggleArchive() }} style={actionBtn}>
              {note.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
            </button>
            <button type="button" title="删除" aria-label="删除" data-danger disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onRemove() }} style={actionBtn}>
              <Trash2 size={12} />
            </button>
          </span>
        </span>
      </div>
    </li>
  )
}

/* ---------- 样式 ---------- */

const cardStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '8px 10px 7px',
  borderRadius: 10,
  border: '1px solid rgba(0, 0, 0, 0.07)',
  boxShadow: '0 1px 5px rgba(0, 0, 0, 0.07)',
  cursor: 'pointer',
}
const cardTitleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  minWidth: 0,
}
const cardTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12.5,
  fontWeight: 600,
  color: NOTE_INK,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const cardSnippet: React.CSSProperties = {
  flex: 1,
  fontSize: 11.5,
  lineHeight: 1.5,
  wordBreak: 'break-word',
}
const cardFooter: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 4,
  paddingTop: 1,
}
const cardActions: React.CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1,
}
const actionBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  cursor: 'pointer',
}
