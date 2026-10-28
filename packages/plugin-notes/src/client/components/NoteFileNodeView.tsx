import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Download, Eye, Paperclip } from 'lucide-react'
import { NoteFile } from '../core/note-richtext.ts'
import { downloadNoteFile, viewNoteFile } from '../core/note-file-cache.ts'
import styles from '../styles/notes-editor.module.css'

export function NoteFileNodeView(props: NodeViewProps): JSX.Element {
  const { node, editor } = props
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
  const rawName = typeof node.attrs.name === 'string' ? node.attrs.name.trim() : ''
  const name = rawName === '' ? '附件' : rawName

  const report = (message: string): void => {
    editor.view.dom.dispatchEvent(
      new CustomEvent('notes-image-error', { bubbles: true, detail: { message } }),
    )
  }

  const view = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    void viewNoteFile(src, name).catch((error) => {
      report('附件打开失败：' + (error instanceof Error ? error.message : String(error)))
    })
  }

  const download = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    void downloadNoteFile(src, name).catch((error) => {
      report('附件下载失败：' + (error instanceof Error ? error.message : String(error)))
    })
  }

  return (
    <NodeViewWrapper
      as="span"
      className={styles.fileChip}
      contentEditable={false}
      data-note-file={src}
    >
      <button type="button" className={styles.fileChipLabel} title={`查看 ${name}`} onClick={view}>
        <Paperclip size={13} className={styles.fileChipIcon} />
        <span className={styles.fileChipName}>{name}</span>
      </button>
      <span className={styles.fileChipActions}>
        <button
          type="button"
          className={styles.fileChipButton}
          title="查看"
          aria-label={`查看 ${name}`}
          onClick={view}
        >
          <Eye size={13} />
        </button>
        <button
          type="button"
          className={styles.fileChipButton}
          title="下载"
          aria-label={`下载 ${name}`}
          onClick={download}
        >
          <Download size={13} />
        </button>
      </span>
    </NodeViewWrapper>
  )
}

export const NoteFileNode = NoteFile.extend({
  addNodeView() {
    return ReactNodeViewRenderer(NoteFileNodeView)
  },
})
