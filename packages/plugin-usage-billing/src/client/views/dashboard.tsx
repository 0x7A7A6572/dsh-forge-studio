/**
 * 仪表盘弹窗（slot: shell.overlay）。
 * shell.overlay 这一层是 click-through 的，所以遮罩自己带 pointer-events。
 */

import { useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore, TabId } from '../core/store.ts'
import { TabOverview } from './tab-overview.tsx'
import { TabTrend } from './tab-trend.tsx'
import { TabHeatmap } from './tab-heatmap.tsx'
import { TabDetail } from './tab-detail.tsx'
import { TabPricing } from './tab-pricing.tsx'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'trend', label: '趋势' },
  { id: 'heatmap', label: '热力图' },
  { id: 'detail', label: '明细' },
  { id: 'pricing', label: '费率' },
]

export function Dashboard(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element | null {
  const { billing, store } = props
  // 必须订阅：入口卡改的是 store 里的 open/tab，不订阅则开合与切页都不会重渲染。
  // hook 必须早于下面的早退调用（否则 open 从 false 变 true 时 hook 数量会变）。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (!state.open) return null
  return (
    <div
      data-dsh-usage-billing
      data-dsh-ub-overlay
      onClick={(e) => { if (e.target === e.currentTarget) store.closePanel() }}
    >
      <section data-dsh-ub-panel role="dialog" aria-label="计费仪表盘">
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>计费</h2>
          <span data-dsh-ub-sub>真实用量 · 按事件时刻价表锁定</span>
          <button type="button" style={{ marginLeft: 'auto' }} onClick={() => store.closePanel()}>关闭</button>
        </header>
        <nav data-dsh-ub-tabs>
          {TABS.map((t) => (
            <button key={t.id} type="button" data-active={state.tab === t.id || undefined}
              onClick={() => store.setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        {state.tab === 'overview' ? <TabOverview billing={billing} store={store} /> : null}
        {state.tab === 'trend' ? <TabTrend billing={billing} store={store} /> : null}
        {state.tab === 'heatmap' ? <TabHeatmap billing={billing} store={store} /> : null}
        {state.tab === 'detail' ? <TabDetail billing={billing} store={store} /> : null}
        {state.tab === 'pricing' ? <TabPricing billing={billing} store={store} /> : null}
      </section>
    </div>
  )
}
