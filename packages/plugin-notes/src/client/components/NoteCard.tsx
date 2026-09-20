/**
 * 便签纸卡（grid 视图）：固定 pastel 纸色 + 深色文字，纸色由 note.color 决定。
 * 悬停浮出操作（编辑/置顶/归档或恢复/删除）；归档态显示「恢复」而非「归档」，
 * 且不提供置顶（归档便签不再参与置顶语义）。
 * 类选择器样式见 styles/notes-board.module.css 的 .card（各组件导入同一份 CSS Module）。
 */

import type { NoteRecord } from '../../types.ts'
import { NOTE_INK, NOTE_INK_MUTED, noteColorMeta } from '../core/note-colors.ts'
import { mdSnippet, firstImageUrl, todoProgress } from '../core/markdown-text.ts'
import { fmtDateTime, fmtRelative } from '../core/time-text.ts'
import { TaskBadge } from './TaskBadge.tsx'
import { TodoBadge } from './TodoBadge.tsx'
import { PinnedCornerMark } from './PinnedCornerMark.tsx'
import { Archive, ArchiveRestore, Pencil, Pin, Trash2 } from 'lucide-react'
import styles from '../styles/notes-board.module.css'

export interface NoteCardProps {
  readonly note: NoteRecord
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onTogglePin: () => void
  readonly onToggleArchive: () => void
  readonly onRemove: () => void
}

export function NoteCard(props: NoteCardProps): JSX.Element {
  const { note } = props
  const meta = noteColorMeta(note.color)
  const snippet = note.text ? mdSnippet(note.text, 140) : ''
  const thumb = note.text ? firstImageUrl(note.text) : null
  const todo = note.text ? todoProgress(note.text) : null
  return (
    <li>
      <div
        className={styles.card}
        role="button"
        tabIndex={0}
        aria-label={note.archived
          ? `已归档：${note.title || '无标题'}`
          : note.pinned
            ? `置顶：${note.title || '无标题'}`
            : note.title || '无标题'}
        onClick={props.onEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            props.onEdit()
          }
        }}
        style={{
          ...cardStyle,
          background: meta.paper,
          ...(note.pinned && !note.archived ? { borderTopRightRadius: 0 } : {}),
        }}
      >
        {note.pinned && !note.archived && <PinnedCornerMark color={meta.ring} />}
        <span style={cardTitleRow}>
          <span style={cardTitle} title={note.title || '（无标题）'}>
            {note.title || <span style={{ color: NOTE_INK_MUTED }}>（无标题）</span>}
          </span>
          {note.lane && <TaskBadge lane={note.lane} />}
          {todo && <TodoBadge done={todo.done} total={todo.total} />}
        </span>
        {thumb && (
          <span style={cardThumbWrap}>
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              style={cardThumbImg}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          </span>
        )}
        {snippet ? (
          <span className={styles.snippet} style={{ ...cardSnippet, color: NOTE_INK_MUTED }}>{snippet}</span>
        ) : (
          <span style={{ ...cardSnippet, color: NOTE_INK_MUTED, fontStyle: 'italic' }}>（无正文）</span>
        )}
        <span style={cardFooter}>
          <time style={{ color: NOTE_INK_MUTED }} title={fmtDateTime(note.updatedAt)}>{fmtRelative(note.updatedAt)}</time>
          <span className={styles.actions} style={cardActions}>
            <button type="button" title="编辑" aria-label="编辑" disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onEdit() }} style={actionBtn}>
              <Pencil size={13} />
            </button>
            {!note.archived && (
              <button type="button" title={note.pinned ? '取消置顶' : '置顶'} aria-label={note.pinned ? '取消置顶' : '置顶'}
                disabled={props.busy}
                onClick={(e) => { e.stopPropagation(); props.onTogglePin() }}
                style={{ ...actionBtn, ...(note.pinned ? { color: meta.ring } : {}) }}>
                <Pin size={13} />
              </button>
            )}
            <button type="button"
              title={note.archived ? '恢复（取消归档）' : '归档'}
              aria-label={note.archived ? '恢复' : '归档'}
              disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onToggleArchive() }} style={actionBtn}>
              {note.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            </button>
            <button type="button" title="删除" aria-label="删除" data-danger disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onRemove() }} style={actionBtn}>
              <Trash2 size={13} />
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
  position: 'relative',
  height: '100%',
  minHeight: 240,
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  padding: '11px 12px 8px',
  borderRadius: 12,
  border: '1px solid rgba(0, 0, 0, 0.07)',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
  cursor: 'pointer',
}
const cardTitleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}
const cardTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 14,
  fontWeight: 600,
  color: NOTE_INK,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const cardSnippet: React.CSSProperties = {
  flex: 1,
  fontSize: 12.5,
  lineHeight: 1.55,
  wordBreak: 'break-word',
}
const cardThumbWrap: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  maxHeight: 110,
  overflow: 'hidden',
  borderRadius: 8,
  background: 'rgba(0, 0, 0, 0.05)',
}
const cardThumbImg: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: 110,
  height: 'auto',
  width: 'auto',
  objectFit: 'contain',
  borderRadius: 8,
}
const cardFooter: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  fontSize: 11.5,
  paddingTop: 2,
}
const cardActions: React.CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
}
const actionBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
}
