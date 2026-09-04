/**
 * 便签板「编辑器弹窗」：浮在列表页（BoardMain）之上的居中弹窗层，
 * 与设置弹窗（settings-dialog）同构 —— 半透明遮罩 + 圆角卡片 + 头部关闭钮。
 * 由 notes-nav 的 editing 目标驱动渲染，target（create | edit+note）翻译成
 * NoteEditor 初值；保存/取消由上层数据控制器提供。
 * 新建/每条便签各一个编辑器实例由 key 保证（编辑器的初值即草稿内容）。
 */

import type { NoteColor, NoteLane, TaskStatus } from '../../types.ts'
import { NoteEditor } from '../components/note-editor.tsx'
import type { EditorTarget } from '../core/notes-nav.ts'
import { t } from '../core/theme-tokens.ts'
import { X } from 'lucide-react'

export interface EditorPageDialogProps {
  /** 当前编辑目标（打开编辑器弹窗必带）。 */
  readonly target: EditorTarget
  /** 标题留空时的默认标题（来自设置命名空间）。 */
  readonly defaultTitle: string
  readonly onCancel: () => void
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
    lanePatch: { readonly on: boolean; readonly status: TaskStatus },
  ) => void | Promise<void>
}

export function EditorPageDialog(props: EditorPageDialogProps): JSX.Element {
  const editing = props.target.mode === 'edit' ? props.target.note : undefined
  // 编辑器初值任务身份：编辑态带出便签既有 lane；新建态普通则 undefined，列头
  // 「＋新建任务」（laneStatus 非空）时合成 `{ status }` 以预填开关 + 状态。
  const initialLane: NoteLane | undefined =
    props.target.mode === 'edit'
      ? props.target.note.lane
      : props.target.laneStatus !== undefined
        ? { status: props.target.laneStatus }
        : undefined
  return (
    <div style={overlayStyle} onClick={props.onCancel}>
      <div
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={editing ? '编辑便签' : '新建便签'}
      >
        <header style={headerStyle}>
          <span style={cardTitle}>
            {editing ? '编辑便签' : '新建便签'}
          </span>
          <button
            type="button"
            title="关闭编辑器"
            aria-label="关闭编辑器"
            onClick={props.onCancel}
            style={iconBtn}
          >
            <X size={14} />
          </button>
        </header>
        <NoteEditor
          key={editing ? editing.id : 'create'}
          initialTitle={editing ? editing.title : ''}
          initialBody={editing ? editing.text : ''}
          initialColor={editing ? editing.color : undefined}
          initialLane={initialLane}
          defaultTitle={props.defaultTitle}
          onCancel={props.onCancel}
          onSave={props.onSave}
        />
      </div>
    </div>
  )
}

/* ---------- 样式（与 settings-dialog 同构） ---------- */

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  display: 'flex',
  background: t.mask,
  padding: 16,
  boxSizing: 'border-box',
  overflow: 'auto',
}
const cardStyle: React.CSSProperties = {
  margin: 'auto',
  width: 'min(680px, 100%)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  background: t.surfaceRaised,
  border: `1px solid ${t.borderL2}`,
  borderRadius: 12,
  boxShadow: t.shadowLv3,
}
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}
const cardTitle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: t.labelPrimary,
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
