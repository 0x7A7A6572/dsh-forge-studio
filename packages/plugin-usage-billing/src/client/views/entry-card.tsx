/** 侧栏入口卡（slot: sidebar.footer.action）—— 本月费用 + 近 7 天 sparkline。 */

import { useEffect, useMemo, useState } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import { billingStore } from '../core/store.ts'
import { formatCny, formatDay } from '../core/format.ts'
import { sparklinePoints } from '../core/chart-data.ts'
import type { DailyPoint, Overview } from '../../view.ts'

export interface EntryCardProps {
  /** ownerProps：sidebar 是否为宽态（false = 56px rail）。 */
  wide: boolean
  billing: UsageBillingRemote
}

export function EntryCard(props: EntryCardProps): JSX.Element {
  const { wide, billing } = props
  const [overview, setOverview] = useState<Overview | null>(null)
  const [days, setDays] = useState<DailyPoint[]>([])
  const [pricingDegraded, setPricingDegraded] = useState(false)
  const [includeSubagents, setInclude] = useState(billingStore.includeSubagents)

  useEffect(() => billingStore.subscribe(() => setInclude(billingStore.includeSubagents)), [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [o, d, p] = await Promise.all([
        billing.overview('month', includeSubagents),
        billing.daily('7d', includeSubagents),
        billing.pricing(),
      ])
      if (!alive) return
      if (o.ok) setOverview(o.value.overview)
      if (d.ok) setDays(d.value.days)
      if (p.ok) setPricingDegraded(p.value.usdToCnySource === 'default')
    })()
    return () => { alive = false }
  }, [billing, includeSubagents])

  const spark = useMemo(
    () => sparklinePoints(days.map((d) => d.costCny), 56, 16),
    [days],
  )

  return (
    <button
      type="button"
      data-dsh-usage-billing
      data-dsh-ub-entry
      data-wide={String(wide)}
      title="计费"
      aria-label="计费"
      onClick={() => billingStore.togglePanel()}
    >
      <span data-dsh-ub-entry-text>
        <span data-dsh-ub-amount>{formatCny(overview?.totalCny ?? 0)}</span>
        <span data-dsh-ub-sub>
          {' '}今日 {formatCny(overview?.todayCny ?? 0)}
        </span>
      </span>
      {wide && spark !== '' ? (
        <svg width={56} height={16} aria-hidden="true">
          <polyline points={spark} fill="none" stroke="currentColor" strokeWidth={1.5} />
        </svg>
      ) : null}
      {pricingDegraded ? <span data-dsh-ub-badge data-kind="warn">内置价</span> : null}
      {overview !== null && overview.unpricedModels.length > 0 ? (
        <span data-dsh-ub-badge data-kind="error">{overview.unpricedModels.length} 未收录</span>
      ) : null}
    </button>
  )
}

export const __test__ = { formatDay }
