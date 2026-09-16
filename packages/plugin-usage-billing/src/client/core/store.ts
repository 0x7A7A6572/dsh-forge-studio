/**
 * client 视图状态（弹窗开合 / tab / 范围 / 指标 / 是否含子代理）。纯对象 + 订阅。
 *
 * `getSnapshot` 返回**同一份不可变状态对象**：只有真正 patch 过才换引用，
 * 因此可以直接喂给 `useSyncExternalStore`（引用稳定，不会无限重渲染）。
 * `subscribe` / `getSnapshot` 都是闭包里的常量函数，跨渲染引用稳定。
 */

import type { RangeKind } from '../../time.ts'

export type TabId = 'overview' | 'trend' | 'heatmap' | 'detail' | 'pricing'
export type TrendMetric = 'cost' | 'token'

export interface BillingViewState {
  open: boolean
  tab: TabId
  range: RangeKind
  metric: TrendMetric
  includeSubagents: boolean
}

export interface BillingStore {
  readonly open: boolean
  readonly tab: TabId
  readonly range: RangeKind
  readonly metric: TrendMetric
  readonly includeSubagents: boolean
  openPanel(): void
  closePanel(): void
  togglePanel(): void
  setTab(tab: TabId): void
  setRange(range: RangeKind): void
  setMetric(metric: TrendMetric): void
  setIncludeSubagents(value: boolean): void
  /** 当前状态的稳定快照（状态未变时引用不变，供 useSyncExternalStore 使用）。 */
  getSnapshot(): BillingViewState
  subscribe(listener: () => void): () => void
}

export function createBillingStore(initial: Partial<BillingViewState> = {}): BillingStore {
  let state: BillingViewState = {
    open: false, tab: 'overview', range: '30d', metric: 'cost', includeSubagents: true, ...initial,
  }
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const l of listeners) l() }
  const patch = (next: Partial<BillingViewState>): void => {
    const merged = { ...state, ...next }
    if (JSON.stringify(merged) === JSON.stringify(state)) return
    state = merged
    emit()
  }
  const store: BillingStore = {
    get open() { return state.open },
    get tab() { return state.tab },
    get range() { return state.range },
    get metric() { return state.metric },
    get includeSubagents() { return state.includeSubagents },
    openPanel: () => patch({ open: true }),
    closePanel: () => patch({ open: false }),
    togglePanel: () => patch({ open: !state.open }),
    setTab: (tab) => patch({ tab }),
    setRange: (range) => patch({ range }),
    setMetric: (metric) => patch({ metric }),
    setIncludeSubagents: (includeSubagents) => patch({ includeSubagents }),
    // 引用只在状态真正变化时更新（patch 提前返回时 state 不换引用）。
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return store
}
