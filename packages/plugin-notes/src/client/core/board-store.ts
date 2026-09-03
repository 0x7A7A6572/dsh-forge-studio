/**
 * 便签板 UI 的模块级存储：入口按钮（sidebar.footer.action）与浮层
 * （shell.overlay）来自同一 client 插件，用这个轻量 store 互通，不依赖
 * 任何服务。组件用 useSyncExternalStore 订阅。
 *
 * 除开关外还持有面板级 UI 状态：视图（列表/grid）与颜色筛选。放在模块级
 * 使「打开/关闭浮层」「切草稿编辑再回来」都不会丢用户选择。
 */

import type { NoteColor } from '../../types.ts'

export type BoardView = 'list' | 'grid'

type Listener = () => void

const state = {
  open: false,
  view: 'list' as BoardView,
  /** 颜色筛选；空数组 = 不过滤（显示全部颜色）。 */
  colors: [] as readonly NoteColor[],
}
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

export const boardStore = {
  get open(): boolean {
    return state.open
  },
  get view(): BoardView {
    return state.view
  },
  get colors(): readonly NoteColor[] {
    return state.colors
  },
  show(): void {
    if (state.open) return
    state.open = true
    emit()
  },
  hide(): void {
    if (!state.open) return
    state.open = false
    emit()
  },
  toggle(): void {
    if (state.open) boardStore.hide()
    else boardStore.show()
  },
  setView(view: BoardView): void {
    if (state.view === view) return
    state.view = view
    emit()
  },
  /** 加入/移出色板筛选（空数组 = 不过滤）。 */
  toggleColor(color: NoteColor): void {
    state.colors = state.colors.includes(color)
      ? state.colors.filter((c) => c !== color)
      : [...state.colors, color]
    emit()
  },
  clearColors(): void {
    if (state.colors.length === 0) return
    state.colors = []
    emit()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
