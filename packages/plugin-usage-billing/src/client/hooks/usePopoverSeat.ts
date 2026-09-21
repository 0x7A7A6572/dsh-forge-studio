/**
 * 触发器锚定的 popup 座位：开合状态、视口内定位、点外部与 Esc 关闭。
 *
 * 与宿主自己的实现同构（ui-chat 的 stat-dialog.ts）：面板 portal 到 body，位置从锚点
 * 算出来并夹在视口边距内 —— 侧栏底部那个触发点离窗口下沿很近，不夹的话面板会挂到屏幕外。
 * 两个 hook 都来自 primitives（平台模块），不自己写测量逻辑。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MutableRefObject } from 'react'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'

/** 视口边距（与宿主 popup 一致）。 */
const MARGIN = 12
/** 触发器与面板之间的距离。 */
const GAP = 8

/** 未定位的测量态：面板先隐藏参与布局，夹取才能拿到真实尺寸。 */
export const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

export interface PopoverSeat {
  open: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
  anchorRef: MutableRefObject<HTMLSpanElement | null>
  panelRef: MutableRefObject<HTMLDivElement | null>
  /** 展开时喂给面板的 fixed 坐标；null 表示还没测量（配 MEASURE_STYLE 用）。 */
  pos: CSSProperties | null
}

export function usePopoverSeat(side: 'top' | 'bottom' = 'top'): PopoverSeat {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const pos = useAnchoredPosition({ open, anchorRef, panelRef, side, gap: GAP, margin: MARGIN })
  useDismissOnOutsidePointer(anchorRef, open, setOpen, panelRef)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])
  const toggle = useCallback(() => { setOpen(!open) }, [open])
  return { open, toggle, setOpen, anchorRef, panelRef, pos }
}
