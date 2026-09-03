/**
 * 便签板「编辑页」（路由 page='editor' 的内容）：草稿容器 + NoteEditor 装配。
 * 由 overlay 的路由出口渲染，target（create | edit+note）来自 notes-nav；
 * 保存/取消由上层数据控制器提供，本页只负责把 target 翻译成 NoteEditor 初值。
 * 新建/每条便签各一个编辑器实例由 key 保证（编辑器的初值即草稿内容）。
 */

import type { NoteColor } from '../../types.ts'
import { NoteEditor } from '../components/note-editor.tsx'
import type { EditorTarget } from '../core/notes-nav.ts'

export interface EditorPageProps {
  /** 当前编辑目标（路由 page='editor' 必带）。 */
  readonly target: EditorTarget
  /** 标题留空时的默认标题（来自设置命名空间）。 */
  readonly defaultTitle: string
  readonly onCancel: () => void
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
  ) => void | Promise<void>
}

export function EditorPage(props: EditorPageProps): JSX.Element {
  const target = props.target
  const editing = target.mode === 'edit' ? target.note : undefined
  return (
    <div style={{ padding: '4px 2px 0' }}>
      <NoteEditor
        key={editing ? editing.id : 'create'}
        initialTitle={editing ? editing.title : ''}
        initialBody={editing ? editing.text : ''}
        initialColor={editing ? editing.color : undefined}
        defaultTitle={props.defaultTitle}
        onCancel={props.onCancel}
        onSave={props.onSave}
      />
    </div>
  )
}
