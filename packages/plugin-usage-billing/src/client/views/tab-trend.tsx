/** 趋势：7/30 天（跟随 store.range），费用 ↔ Token 切换。 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { BarChart } from './chart.tsx'
import { formatCny, formatDay, formatInt } from '../core/format.ts'
import type { DailyPoint } from '../../view.ts'

export function TabTrend(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [days, setDays] = useState<DailyPoint[] | null>(null)
  // 回填标记（常驻，不可关）：趋势里每一天的费用同样含安装前估算的账，和概览一个口径。
  const [hasBackfilled, setHasBackfilled] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      billing.daily(state.range, state.includeSubagents),
      billing.overview(state.range, state.includeSubagents),
    ]).then(([d, o]) => {
      if (!alive) return
      if (d.ok) setDays(d.value.days)
      if (o.ok) setHasBackfilled(o.value.overview.hasBackfilled)
    })
    return () => { alive = false }
  }, [billing, state.range, state.includeSubagents])

  if (days === null) return <div data-dsh-ub-empty>正在读取用量…</div>
  if (days.length === 0) return <div data-dsh-ub-empty>这个范围里还没有用量记录。</div>

  const tokenMetric = state.metric === 'token'
  const values = days.map((d) => tokenMetric
    ? d.input + d.cacheRead + d.cacheWrite + d.output
    : d.costCny)

  return (
    <div data-dsh-usage-billing>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        {(['7d', '30d'] as const).map((r) => (
          <button key={r} type="button" data-active={state.range === r || undefined}
            onClick={() => store.setRange(r)}>{r === '7d' ? '近 7 天' : '近 30 天'}</button>
        ))}
        {(['cost', 'token'] as const).map((m) => (
          <button key={m} type="button" data-active={state.metric === m || undefined}
            onClick={() => store.setMetric(m)}>{m === 'cost' ? '费用' : 'Token'}</button>
        ))}
        {hasBackfilled ? <span data-dsh-ub-estimate>含安装前估算</span> : null}
        <span data-dsh-ub-sub style={{ marginLeft: 'auto' }}>
          合计 {tokenMetric ? formatInt(values.reduce((a, b) => a + b, 0)) + ' tok' : formatCny(values.reduce((a, b) => a + b, 0))}
        </span>
      </div>
      <BarChart values={values} labels={days.map((d) => formatDay(d.day))} width={960} height={180} />
      <ul data-dsh-ub-sub style={{ marginTop: 10 }}>
        {[...days].reverse().slice(0, 7).map((d) => (
          <li key={d.day}>{d.day} · {formatCny(d.costCny)} · {formatInt(d.calls)} 次调用</li>
        ))}
      </ul>
    </div>
  )
}
