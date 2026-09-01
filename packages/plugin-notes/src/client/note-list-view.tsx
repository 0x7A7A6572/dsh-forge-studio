/**
 * 便签板渲染器：折叠 note/listed 快照的卡片。板内新建/编辑走 tiptap 编辑器，
 * 保存时把操作翻译成 /note 命令行发回会话（host 执行并写回 note/listed）。
 */

import { useMemo, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { NoteRecord } from '../types.ts'
import type { NoteBoardViewData } from './note-list-definition.ts'

/** 渲染器注入面：把一行 /note 命令发给当前会话；maxVisibleNotes 来自设置。 */
export interface NoteListCardFace {
  command(line: string): Promise<boolean>
  readonly maxVisibleNotes?: number
}

export type NoteListViewProps = {
  node: ChatNode<'note-list'>
} & InjectFace<NoteListCardFace>

interface Draft {
  readonly mode: 'create' | 'edit'
  readonly note?: NoteRecord
  readonly title: string
  readonly body: string
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function NoteListView(props: NoteListViewProps): JSX.Element {
  const data: NoteBoardViewData | undefined = props.node.data
  const notes = data?.notes ?? []
  const maxVisible = props.maxVisibleNotes ?? notes.length
  const visible = notes.slice(0, maxVisible)
  const [draft, setDraft] = useState<Draft | undefined>()

  // 编辑器随草稿身份重建（新建/每条便签各一个实例），初值即草稿正文。
  const editor = useEditor(
    { extensions: [StarterKit], content: draft?.body ?? '' },
    [draft?.note?.id ?? 'create'],
  )

  const rows = useMemo(() => {
    const list = visible.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
    return list.map((note) => (
      <li key={note.id} style={rowStyle}>
        <span>{note.pinned ? '📌' : '·'}</span>
        <span style={{ fontWeight: 600 }}>{note.title}</span>
        <span style={snippetStyle}>{note.text.replace(/\s+/g, ' ').slice(0, 60)}</span>
        <span style={timeStyle}>{fmtTime(note.updatedAt)}</span>
        <span style={actionStyle}>
          <button onClick={() => startEdit(note)}>编辑</button>
          <button onClick={() => void run(`/note ${note.pinned ? 'unpin' : 'pin'} ${note.id}`)}>
            {note.pinned ? '取消置顶' : '置顶'}
          </button>
          <button onClick={() => void run(`/note rm ${note.id}`)}>删除</button>
        </span>
      </li>
    ))
  }, [visible])

  function startEdit(note: NoteRecord): void {
    setDraft({ mode: 'edit', note, title: note.title, body: note.text })
  }

  function startCreate(): void {
    setDraft({ mode: 'create', title: '', body: '' })
  }

  async function run(line: string): Promise<void> {
    const ok = await props.command(line)
    if (!ok) {
      // host 未接受（命令未注册或语法错误）——静默，保持板面不变
      console.warn('[plugin-notes] command rejected:', line)
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draft) return
    const title = draft.title.trim()
    const body = (editor?.getText() ?? '').trim()
    if (!title && !body) {
      setDraft(undefined)
      return
    }
    const text = `${title}${body ? `：${body}` : ''}`
    const line = draft.mode === 'create'
      ? `/note add ${text}`
      : `/note edit ${draft.note?.id} ${text}`
    setDraft(undefined)
    await run(line)
  }

  return (
    <section style={cardStyle}>
      <header style={headerStyle}>
        <span style={{ fontWeight: 600 }}>便签板（{notes.length}）</span>
        <button onClick={startCreate}>＋ 新建</button>
      </header>

      {draft ? (
        <div style={editorStyle}>
          <input
            placeholder="标题"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            style={{ width: '100%', boxSizing: 'border-box', padding: '4px 8px' }}
          />
          <EditorContent editor={editor} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 6, minHeight: 72 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setDraft(undefined)}>取消</button>
            <button onClick={() => void saveDraft()}>保存</button>
          </div>
        </div>
      ) : notes.length === 0 ? (
        <p style={{ color: '#888', margin: 0 }}>暂无便签。让助手记一条，或点「＋ 新建」。</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>{rows}</ul>
      )}
    </section>
  )
}

const cardStyle: React.CSSProperties = {
  padding: 8,
  border: '1px solid #ddd',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}
const headerStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }
const snippetStyle: React.CSSProperties = { color: '#666', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const timeStyle: React.CSSProperties = { color: '#999', fontSize: 12 }
const actionStyle: React.CSSProperties = { display: 'flex', gap: 6 }
const editorStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }
