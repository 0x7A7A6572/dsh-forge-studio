/**
 * 便签板开关的模块级存储：入口按钮（sidebar.footer.action）与浮层
 * （shell.overlay）来自同一 client 插件，用这个轻量 store 互通，不依赖
 * 任何服务。组件用 useSyncExternalStore 订阅。
 */

type Listener = () => void

const state = { open: false }
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

export const boardStore = {
  get open(): boolean {
    return state.open
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
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
