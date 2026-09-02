/**
 * 便签编辑器（tiptap）：标题输入 + 富文本正文。父组件用 key 控制实例
 * 重建（新建/每条便签各一个编辑器），初值即草稿内容。
 */

import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

export interface NoteEditorProps {
  readonly initialTitle: string
  readonly initialBody: string
  /** 标题留空时使用的默认标题（来自设置）。 */
  readonly defaultTitle: string
  readonly onCancel: () => void
  readonly onSave: (title: string, body: string) => void | Promise<void>
}

export function NoteEditor(props: NoteEditorProps): JSX.Element {
  const [title, setTitle] = useState(props.initialTitle)
  const [saving, setSaving] = useState(false)

  const editor = useEditor({ extensions: [StarterKit], content: props.initialBody })

  async function save(): Promise<void> {
    const body = (editor?.getText() ?? '').trim()
    const trimmed = title.trim()
    if (!trimmed && !body) {
      props.onCancel()
      return
    }
    setSaving(true)
    try {
      await props.onSave(trimmed || props.defaultTitle, body)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={editorStyle}>
      <input
        placeholder="标题（留空用默认标题）"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={titleStyle}
      />
      <EditorContent editor={editor} style={contentStyle} />
      <div style={actionStyle}>
        <button onClick={props.onCancel} disabled={saving}>
          取消
        </button>
        <button onClick={() => void save()} disabled={saving}>
          保存
        </button>
      </div>
    </div>
  )
}

const editorStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }
const titleStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '4px 8px' }
const contentStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 6,
  minHeight: 72,
  background: '#fff',
}
const actionStyle: React.CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end' }
