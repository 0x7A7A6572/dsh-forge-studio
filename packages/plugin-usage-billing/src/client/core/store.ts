/**
 * client 视图状态（趋势范围 / 指标 / 是否含子代理）。纯对象 + 订阅。
 *
 * 弹窗没了（计费视图搬进设置页），所以这里不再有 open/tab：页内切换是设置页自己的
 * 局部状态，视图状态只留**跨页面共享**的那几个（趋势范围、指标、子代理口径）。
 *
 * `getSnapshot` 返回**同一份不可变状态对象**：只有真正 patch 过才换引用，
 * 因此可以直接喂给 `useSyncExternalStore`（引用稳定，不会无限重渲染）。
 * `subscribe` / `getSnapshot` 都是闭包里的常量函数，跨渲染引用稳定。
 */

import type { RangeKind } from '../../time.ts'

export type TabId = 'overview' | 'trend' | 'detail'
export type TrendMetric = 'cost' | 'token'

export interface BillingViewState {
  range: RangeKind
  metric: TrendMetric
  includeSubagents: boolean
}

export interface BillingStore {
  readonly range: RangeKind
  readonly metric: TrendMetric
  readonly includeSubagents: boolean
  setRange(range: RangeKind): void
  setMetric(metric: TrendMetric): void
  setIncludeSubagents(value: boolean): void
  /** 当前状态的稳定快照（状态未变时引用不变，供 useSyncExternalStore 使用）。 */
  getSnapshot(): BillingViewState
  subscribe(listener: () => void): () => void
}

export function createBillingStore(initial: Partial<BillingViewState> = {}): BillingStore {
  let state: BillingViewState = { range: '30d', metric: 'cost', includeSubagents: true, ...initial }
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const l of listeners) l() }
  const patch = (next: Partial<BillingViewState>): void => {
    const merged = { ...state, ...next }
    if (JSON.stringify(merged) === JSON.stringify(state)) return
    state = merged
    emit()
  }
  const store: BillingStore = {
    get range() { return state.range },
    get metric() { return state.metric },
    get includeSubagents() { return state.includeSubagents },
    setRange: (range) => patch({ range }),
    setMetric: (metric) => patch({ metric }),
    setIncludeSubagents: (includeSubagents) => patch({ includeSubagents }),
    // 引用只在状态真正变化时更新（patch 提前返回时 state 不换引用）。
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return store
}
