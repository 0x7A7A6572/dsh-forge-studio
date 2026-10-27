/**
 * 便签图片 NodeView：解析 notes-asset 引用后再渲染；编辑态保留拖拽缩放。
 * 内联 span 包住 <img> + 右下角拖拽把手；保持图片随正文内联流动。
 * 选中图片时把手显示，按下把手拖拽 → 按 .ProseMirror 正文宽度换算百分比，
 * 拖动中只改本地 liveWidth，松开一次性 updateAttributes 落盘。
 * 双击把手清空宽度（恢复默认上限）。
 * http(s)/data URL 原样渲染；引用读不到时显示「图片已丢失」，只读正文也挂本组件。
 */

import { useRef, useState } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { MoveDiagonal2 } from 'lucide-react'
import { NoteImage } from '../core/note-richtext.ts'
import { useNoteImageSrc } from '../hooks/useNoteImageSrc.ts'
import {
  clampImageWidthPercent,
  nextImageWidthPercent,
} from '../core/image-resize.ts'
import editorStyles from '../styles/notes-editor.module.css'

interface DragState {
  startX: number
  startPct: number
  contentWidth: number
  lastPct: number
}

export function NoteImageView(props: NodeViewProps): JSX.Element {
  const { node, updateAttributes, editor, selected } = props
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<DragState | null>(null)
  /** 拖拽中的临时宽度（"NN%"）；null = 使用节点已保存的 width。 */
  const [liveWidth, setLiveWidth] = useState<string | null>(null)
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
  const image = useNoteImageSrc(src)

  const savedWidth =
    typeof node.attrs.width === 'string' && node.attrs.width.trim() !== ''
      ? node.attrs.width
      : null
  const shown = liveWidth ?? savedWidth

  function onPointerDown(e: React.PointerEvent<HTMLSpanElement>): void {
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    const contentWidth = editor.view.dom.clientWidth
    if (!img || contentWidth <= 0) return
    const startPct = clampImageWidthPercent(
      (img.getBoundingClientRect().width / contentWidth) * 100,
    )
    dragRef.current = { startX: e.clientX, startPct, contentWidth, lastPct: startPct }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLSpanElement>): void {
    const drag = dragRef.current
    if (!drag) return
    const pct = nextImageWidthPercent(
      drag.startPct,
      e.clientX - drag.startX,
      drag.contentWidth,
    )
    drag.lastPct = pct
    setLiveWidth(pct + '%')
  }

  function onPointerUp(e: React.PointerEvent<HTMLSpanElement>): void {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const finalPct = drag.lastPct
    setLiveWidth(null)
    updateAttributes({ width: finalPct + '%' })
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  function onPointerCancel(e: React.PointerEvent<HTMLSpanElement>): void {
    dragRef.current = null
    setLiveWidth(null)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  function onDoubleClick(e: React.MouseEvent<HTMLSpanElement>): void {
    e.preventDefault()
    e.stopPropagation()
    setLiveWidth(null)
    updateAttributes({ width: null })
  }

  return (
    <NodeViewWrapper as="span" className={editorStyles.imageWrap}>
      {image.failed && (
        <span className={editorStyles.imageMissing} role="img" aria-label="图片已丢失">
          图片已丢失
          <button type="button" className={editorStyles.imageMissingRetry} onClick={image.retry}>
            重试
          </button>
        </span>
      )}
      {image.url === undefined && !image.failed && (
        <span className={editorStyles.imageLoading} aria-label="图片加载中" />
      )}
      {image.url !== undefined && (
        <img
          ref={imgRef}
          src={image.url}
          alt={typeof node.attrs.alt === 'string' ? node.attrs.alt : ''}
          title={typeof node.attrs.title === 'string' ? node.attrs.title : undefined}
          width={shown ?? undefined}
          draggable={false}
        />
      )}
      {selected && editor.isEditable && image.url !== undefined && (
        <span
          className={editorStyles.imageHandle}
          title="拖拽缩放图片宽度（双击恢复默认）"
          aria-label="缩放图片宽度"
          role="button"
          tabIndex={-1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDoubleClick={onDoubleClick}
        >
          <MoveDiagonal2 size={13} strokeWidth={2.5} />
        </span>
      )}
    </NodeViewWrapper>
  )
}

/** 编辑与只读共用的图片节点：引用解析 + 编辑态拖拽缩放。 */
export const NoteImageNode = NoteImage.extend({
  draggable: false,
  addNodeView() {
    return ReactNodeViewRenderer(NoteImageView)
  },
})
