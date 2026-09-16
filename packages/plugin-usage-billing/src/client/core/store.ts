/** client 视图状态（弹窗开合 / tab / 范围 / 指标 / 是否含子代理）。纯对象 + 订阅。 */

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
  return {
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
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

/** 进程内单例（同一页面共享一份视图状态）。 */
export const billingStore = createBillingStore()
