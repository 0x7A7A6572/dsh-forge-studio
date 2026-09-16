/** 热力图：日历色阶（5 档）+ 活跃天数 / 连续天数。 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { calendarMatrix } from '../core/heatmap.ts'
import { formatCny } from '../core/format.ts'
import type { DailyPoint } from '../../view.ts'

function longestStreak(days: readonly DailyPoint[]): number {
  let best = 0; let cur = 0
  for (const d of days) {
    cur = d.calls > 0 ? cur + 1 : 0
    if (cur > best) best = cur
  }
  return best
}

export function TabHeatmap(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [days, setDays] = useState<DailyPoint[] | null>(null)
  // 常驻回填标记（不可关）：色阶里的金额同样含安装前估算的账。
  const [hasBackfilled, setHasBackfilled] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      billing.daily('all', state.includeSubagents),
      billing.overview('all', state.includeSubagents),
    ]).then(([d, o]) => {
      if (!alive) return
      if (d.ok) setDays(d.value.days)
      if (o.ok) setHasBackfilled(o.value.overview.hasBackfilled)
    })
    return () => { alive = false }
  }, [billing, state.includeSubagents])

  const matrix = useMemo(() => days === null ? [] : calendarMatrix(
    days.map((d) => d.day),
    new Map(days.map((d) => [d.day, d.costCny])),
    { firstDayOfWeek: 1 },
  ), [days])

  if (days === null) return <div data-dsh-ub-empty>正在读取用量…</div>
  if (days.length === 0) return <div data-dsh-ub-empty>这个范围里还没有用量记录。</div>

  const active = days.filter((d) => d.calls > 0).length

  return (
    <div data-dsh-usage-billing>
      <div data-dsh-ub-sub>
        活跃 {active} 天 · 共 {days.length} 天 · 最长连续 {longestStreak(days)} 天
        {hasBackfilled ? <span data-dsh-ub-estimate> · 含安装前估算</span> : null}
      </div>
      <div data-dsh-ub-heat style={{ marginTop: 10 }}>
        {matrix.flat().map((cell, i) => (
          <span key={cell?.day ?? `pad-${i}`} data-level={cell?.level ?? 0}
            title={cell === null ? '' : `${cell.day}：${formatCny(cell.value)}`} />
        ))}
      </div>
    </div>
  )
}
