/**
 * 便签板「编辑器弹窗」：浮在列表页（BoardMain）之上的居中弹窗层。
 * 半透明遮罩 + 纸卡（背景即当前便签纸色）；整卡无边框，正文与控件走 NOTE_INK
 * 墨迹族（见 note-editor 的 .fs-note-editor--paper）。
 * 弹窗头部不再有独立「新建便签」标签行 —— 可编辑的便签标题由 NoteEditor 自己的
 * header 行承担（标题即 header，省一行），关闭钮也在该行右侧。
 * 由 notes-nav 的 editing 目标驱动渲染，target（create | edit+note）翻译成
 * NoteEditor 初值；保存/取消由上层数据控制器提供。
 * 新建/每条便签各一个编辑器实例由 key 保证（编辑器的初值即草稿内容）。
 */

import { useEffect, useState } from 'react'
import { DEFAULT_NOTE_COLOR } from '../../types.ts'
import type { NoteColor, NoteLane, TaskStatus } from '../../types.ts'
import { NoteEditor } from '../components/note-editor.tsx'
import { noteColorMeta } from '../core/note-colors.ts'
import type { EditorTarget } from '../core/notes-nav.ts'
import { t } from '../core/theme-tokens.ts'

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
  // 编辑态带出便签既有 lane（驱动开关预选 + 只读结果区）；新建态不合成 lane（M4：
  // 结果区仅编辑模式），列头「＋新建任务」改用 initialLaneStatus 只预填开关 + 状态。
  const initialLane: NoteLane | undefined =
    props.target.mode === 'edit' ? props.target.note.lane : undefined
  const initialLaneStatus: TaskStatus | undefined =
    props.target.mode === 'create' ? props.target.laneStatus : undefined
  // 当前弹窗纸色：编辑带出便签既有色，新建默认黄；随底部取色器实时更新。
  const initialPaper: NoteColor = editing?.color ?? DEFAULT_NOTE_COLOR
  const [paper, setPaper] = useState<NoteColor>(initialPaper)
  // 编辑目标切换（编辑 A → 编辑 B / 新建）时同步纸色初值，避免沿用上一张颜色。
  useEffect(() => {
    setPaper(initialPaper)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.target])
  const paperMeta = noteColorMeta(paper)
  return (
    <div className="fs-note-overlay" style={overlayStyle} onClick={props.onCancel}>
      <div
        className="fs-note-dialog"
        style={cardStyle(paperMeta.paper)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={editing ? '编辑便签' : '新建便签'}
      >
        <NoteEditor
          key={editing ? editing.id : 'create'}
          initialTitle={editing ? editing.title : ''}
          initialBody={editing ? editing.text : ''}
          initialColor={editing ? editing.color : undefined}
          initialLane={initialLane}
          initialLaneStatus={initialLaneStatus}
          defaultTitle={props.defaultTitle}
          onColorChange={setPaper}
          onCancel={props.onCancel}
          onSave={props.onSave}
        />
      </div>
    </div>
  )
}

/* ---------- 样式（纸卡：无边框，背景即纸色） ---------- */

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
/**
 * 便签纸卡片：无边框，背景 = 当前纸色（pastel），浅底墨迹文字。
 * 阴影保留以与遮罩分层（浅纸卡在遮罩上仍需轻投影），用宿主 shadow-lv3 令牌随主题。
 */
const cardStyle = (paper: string): React.CSSProperties => ({
  margin: 'auto',
  width: 'min(680px, 100%)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 14,
  background: paper,
  borderRadius: 12,
  boxShadow: t.shadowLv3,
})
