/**
 * 仪表盘弹窗（slot: shell.overlay）。
 * shell.overlay 这一层是 click-through 的，所以遮罩自己带 pointer-events。
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore, TabId } from '../core/store.ts'
import type { BillingConfig, BillingScope } from '../core/config.ts'
import { BackfillNotice } from './backfill-notice.tsx'
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

export function Dashboard(props: {
  /** 远程面首帧可能未挂载；各 tab 自己早退（类型如实）。 */
  billing: UsageBillingRemote | undefined
  store: BillingStore
  /** 回填提示条的一次性关闭状态存在宿主设置里（`notices.backfillDismissed`），不用本地存储。 */
  scope: BillingScope
}): JSX.Element | null {
  const { billing, store, scope } = props
  // 必须订阅：入口卡改的是 store 里的 open/tab，不订阅则开合与切页都不会重渲染。
  // hook 必须早于下面的早退调用（否则 open 从 false 变 true 时 hook 数量会变）。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // 设置快照同样订阅：关闭提示条写回宿主后，这里必须跟着消失。
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const cfg: BillingConfig = settings.value

  /** 一次性关闭：写回宿主 notices（快照更新后提示条永久消失，重开弹窗也不会回来）。 */
  const dismissBackfill = useCallback(() => {
    const notices = cfg?.notices ?? { backfillDismissed: false, budgetNotified: {} }
    void scope.set('notices', { ...notices, backfillDismissed: true })
      .catch(() => { /* 写失败时不本地妥协：快照仍是 host 的真值，提示条留在原处 */ })
  }, [scope, cfg])

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
        {/* 安装时刻未知（installAt 未落盘）时不渲染：宁可不说，也不能报一个假日期。 */}
        {cfg !== undefined && cfg.installAt > 0 ? (
          <BackfillNotice
            installAt={cfg.installAt}
            dismissed={cfg.notices?.backfillDismissed === true}
            // 只读 scope 下写不入宿主：把按钮禁用，别留一个按了没反应的按钮。
            writable={settings.writable}
            onDismiss={dismissBackfill}
          />
        ) : null}
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
