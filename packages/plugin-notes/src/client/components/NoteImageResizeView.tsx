/**
 * 便签图片可缩放 NodeView（仅编辑态挂载，见 NoteImageResizable）：
 * - 内联 span 包住 <img> + 右下角拖拽把手；保持图片随正文内联流动；
 * - 选中图片时把手显示，按下把手拖拽 → 按 .ProseMirror 正文宽度换算百分比，
 *   拖动中只改本地 liveWidth（不频繁发事务），松开一次性 updateAttributes 落盘（可撤销）；
 * - 双击把手清空宽度（恢复默认 66.67% 上限）。
 * 只读渲染（note-preview 等）不走本组件：用普通 NoteImage + renderHTML 输出 width 属性。
 */

import { useRef, useState } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { MoveDiagonal2 } from 'lucide-react'
import { NoteImage } from '../core/note-richtext.ts'
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

export function NoteImageResizeView(props: NodeViewProps): JSX.Element {
  const { node, updateAttributes, editor, selected } = props
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<DragState | null>(null)
  /** 拖拽中的临时宽度（"NN%"，仅本地渲染）；null = 使用节点已保存的 width。 */
  const [liveWidth, setLiveWidth] = useState<string | null>(null)

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
      <img
        ref={imgRef}
        src={typeof node.attrs.src === 'string' ? node.attrs.src : ''}
        alt={typeof node.attrs.alt === 'string' ? node.attrs.alt : ''}
        title={typeof node.attrs.title === 'string' ? node.attrs.title : undefined}
        width={shown ?? undefined}
        draggable={false}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
      {selected && editor.isEditable && (
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

/** 编辑态图片扩展：在 NoteImage 基础上挂拖拽手柄 NodeView，并关闭节点拖拽
 *  （避免与手柄拖拽冲突；图片仍可通过剪贴/方向键调整位置）。 */
export const NoteImageResizable = NoteImage.extend({
  draggable: false,
  addNodeView() {
    return ReactNodeViewRenderer(NoteImageResizeView)
  },
})
