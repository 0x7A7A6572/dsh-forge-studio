/**
 * 便签板「编辑器弹窗」：浮在列表页（BoardMain）之上的居中弹窗层。
 * 半透明遮罩 + 纸卡（背景即当前便签纸色）；整卡无边框，正文与控件走 NOTE_INK
 * 墨迹族（见 NoteEditor 的 styles.paper）。
 * 弹窗头部不再有独立「新建便签」标签行 —— 可编辑的便签标题由 NoteEditor 自己的
 * header 行承担（标题即 header，省一行），关闭钮也在该行右侧。
 * 由 notes-nav 的 editing 目标驱动渲染，target（create | edit+note）翻译成
 * NoteEditor 初值；保存/取消由上层数据控制器提供。
 * 新建/每条便签各一个编辑器实例由 key 保证（编辑器的初值即草稿内容）。
 */

import type { NoteColor, NoteLane, TaskStatus, TaskTargets } from '../../types.ts'
import { NoteEditor } from './NoteEditor.tsx'
import type { NoteSaveOptions, NoteTaskDraft } from './NoteEditor.tsx'
import { noteColorMeta } from '../core/note-colors.ts'
import type { EditorTarget } from '../core/notes-nav.ts'
import { t } from '../core/theme-tokens.ts'
import { useEditorPageDialog } from '../hooks/useEditorPageDialog.ts'
import styles from '../styles/notes-board.module.css'

export interface EditorPageDialogProps {
  /** 当前编辑目标（打开编辑器弹窗必带）。 */
  readonly target: EditorTarget
  /** 标题留空时的默认标题（来自设置命名空间）。 */
  readonly defaultTitle: string
  /** 工作区候选（最近会话用过的 cwd；下拉只选不手填，标签只给文件夹名）。 */
  readonly workspaceOptions?: readonly string[]
  /** 工作区候选是否已加载完成（未就绪时不写「未配置」，避免提示一闪而过）。 */
  readonly workspaceReady?: boolean
  /** 任务执行目标目录（模型 / agent 预设）；空目录即只有「宿主默认」可选。 */
  readonly taskTargets?: TaskTargets
  readonly onCancel: () => void
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: NoteTaskDraft,
    /** 保存选项：close/silent（自动保存、Ctrl+S 传 close:false）。 */
    options?: NoteSaveOptions,
  ) => void | Promise<void>
}

export function EditorPageDialog(props: EditorPageDialogProps): JSX.Element {
  const editing = props.target.mode === 'edit' ? props.target.note : undefined
  // 新建态的预填内容（助手消息「存成便签」带的回答）；不带就是空的编辑器。
  const draft = props.target.mode === 'create' ? props.target.draft : undefined
  // 编辑态带出便签既有 lane（驱动开关预选 + 只读结果区）；新建态不合成 lane（M4：
  // 结果区仅编辑模式），列头「＋新建任务」改用 initialLaneStatus 只预填开关 + 状态。
  const initialLane: NoteLane | undefined =
    props.target.mode === 'edit' ? props.target.note.lane : undefined
  const initialLaneStatus: TaskStatus | undefined =
    props.target.mode === 'create' ? props.target.laneStatus : undefined
  // 当前弹窗纸色：编辑带出便签既有色，新建默认黄；随底部取色器实时更新。
  const { paper, setPaper } = useEditorPageDialog(props.target)
  const paperMeta = noteColorMeta(paper)
  return (
    <div className={styles.overlay} style={overlayStyle} onClick={props.onCancel}>
      <div
        className={styles.dialog}
        style={cardStyle(paperMeta.paper)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={editing ? '编辑便签' : '新建便签'}
      >
        <NoteEditor
          // 新建态用 nonce 当 key：预填内容变了要换一个编辑器实例，否则初值不生效（见 notes-nav）。
          key={editing ? editing.id : `create:${props.target.mode === 'create' ? (props.target.nonce ?? 0) : 0}`}
          initialTitle={editing ? editing.title : (draft?.title ?? '')}
          initialBody={editing ? editing.text : (draft?.text ?? '')}
          initialColor={editing ? editing.color : undefined}
          initialLane={initialLane}
          initialLaneStatus={initialLaneStatus}
          initialWorkspace={editing?.workspace}
          initialSchedule={editing?.schedule}
          defaultTitle={props.defaultTitle}
          workspaceOptions={props.workspaceOptions}
          workspaceReady={props.workspaceReady}
          taskTargets={props.taskTargets}
          // 编辑既有便签才自动保存：新建态没有库记录（保存即创建），无从自动落盘。
          autoSave={props.target.mode === 'edit'}
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
