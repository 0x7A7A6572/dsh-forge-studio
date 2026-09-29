/**
 * 弹窗遮罩的「点外面就关」事件处理器：展开到最外层遮罩 div 上即可
 * （`<div className={styles.overlay} {...backdrop}>`）。
 *
 * 判定逻辑见 core/backdrop-dismiss.ts —— 这里只负责把它接到 React 事件上，
 * 并且**不再**用裸 `onClick={onCancel}`：那样会把「卡片里按下选文字、拖到卡片外
 * 松手」误判成点遮罩，编辑页直接退出且不保存（issue #3）。
 */

import { useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { createBackdropDismissGuard } from '../core/backdrop-dismiss.ts'

/** 遮罩层需要的两个处理器。 */
export interface BackdropDismissHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void
  readonly onClick: (event: MouseEvent<HTMLElement>) => void
}

/**
 * @param onDismiss 判定为「点遮罩」时调用（关闭弹窗）。每次渲染都取最新那个。
 */
export function useBackdropDismiss(onDismiss: () => void): BackdropDismissHandlers {
  const guard = useRef(createBackdropDismissGuard())
  return {
    onPointerDown: (event) => guard.current.press(event.target, event.currentTarget),
    onClick: (event) => {
      if (guard.current.release(event.target, event.currentTarget)) onDismiss()
    },
  }
}
