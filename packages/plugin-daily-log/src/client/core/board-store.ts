/**
 * daily-log 面板 UI 的模块级 store：侧栏入口行与中间列面板来自同一 client 插件，
 * 用这个轻量 store 互通（开/关 + 当前 tab），不依赖任何服务。组件用 useSyncExternalStore 订阅。
 */

export type DailyLogTab = 'sources' | 'reports' | 'templates'

type Listener = () => void

const state = {
  open: false,
  tab: 'reports' as DailyLogTab,
}
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

export const boardStore = {
  get open(): boolean {
    return state.open
  },
  get tab(): DailyLogTab {
    return state.tab
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
  setTab(tab: DailyLogTab): void {
    if (state.tab === tab) return
    state.tab = tab
    emit()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
