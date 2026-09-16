/** 概览：Hero 本月费用 + 环比 + 预计 + KPI + 预算条 + 未收录提示 + 回填角标。 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { evaluateBudget } from '../../budget.ts'
import { formatCny, formatInt, formatPct } from '../core/format.ts'
import type { Overview } from '../../view.ts'

export function TabOverview(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element {
  const { billing, store } = props
  // 必须订阅（不订阅的话切范围/切子代理口径不会重取数据）：与 Dashboard / 入口卡同一姿态。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [data, setData] = useState<{ overview: Overview; budget: { enabled: boolean; monthlyCny: number } } | null>(null)

  useEffect(() => {
    let alive = true
    void billing.overview(state.range, state.includeSubagents).then((r) => {
      if (alive && r.ok) setData({ overview: r.value.overview, budget: r.value.budget })
    })
    return () => { alive = false }
  }, [billing, state.range, state.includeSubagents])

  if (data === null) return <div data-dsh-ub-empty>正在读取用量…</div>
  const { overview, budget } = data
  const spend = evaluateBudget({
    spentCny: overview.totalCny, monthlyCny: budget.monthlyCny,
    enabled: budget.enabled, notified: {}, monthKey: new Date().toISOString().slice(0, 7),
  })

  return (
    <div data-dsh-usage-billing>
      <div data-dsh-ub-hero>{formatCny(overview.totalCny)}</div>
      <div data-dsh-ub-sub>
        当前范围合计 · 今日 {formatCny(overview.todayCny)} · 本周 {formatCny(overview.weekCny)}
        {overview.hasBackfilled ? <span data-dsh-ub-estimate> · 含安装前估算</span> : null}
      </div>

      {budget.enabled ? (
        <section style={{ marginTop: 14 }}>
          <div data-dsh-ub-sub>预算 {formatCny(budget.monthlyCny)} · 已用 {formatPct(spend.pct, 0)}</div>
          <div data-dsh-ub-bar data-level={spend.level}>
            <i style={{ width: `${Math.min(100, spend.pct * 100)}%` }} />
          </div>
        </section>
      ) : null}

      <section data-dsh-ub-kpis style={{ marginTop: 16 }}>
        <div data-dsh-ub-kpi><div data-dsh-ub-sub>日均</div><div>{formatCny(overview.avgDailyCny)}</div></div>
        <div data-dsh-ub-kpi><div data-dsh-ub-sub>调用次数</div><div>{formatInt(overview.calls)}</div></div>
        <div data-dsh-ub-kpi><div data-dsh-ub-sub>缓存命中率</div><div>{formatPct(overview.cacheHitRate)}</div></div>
        <div data-dsh-ub-kpi>
          <div data-dsh-ub-sub>未收录模型</div>
          <div>{overview.unpricedModels.length === 0 ? '0' : `${overview.unpricedModels.length} 未收录`}</div>
        </div>
      </section>

      {overview.unpricedModels.length > 0 ? (
        <p data-dsh-ub-estimate>
          {overview.unpricedRows} 条记录涉及 {overview.unpricedModels.length} 个未收录模型（
          {overview.unpricedModels.slice(0, 3).join('、')}），已按 ¥0 计但未静默忽略 —— 到「费率」页补单价即可。
        </p>
      ) : null}
    </div>
  )
}
