/** 侧栏入口卡（slot: sidebar.footer.action）—— 本月费用 + 近 7 天 sparkline。 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { formatCny, formatDay } from '../core/format.ts'
import { sparklinePoints } from '../core/chart-data.ts'
import type { DailyPoint, Overview } from '../../view.ts'

/** 概览未到 / 整本账未定价时的占位：`¥0.00` 与真实零费用在界面上无法区分。 */
const PENDING = '—'

export interface EntryCardProps {
  /** ownerProps：sidebar 是否为宽态（false = 56px rail）。 */
  wide: boolean
  /** 远程面可能晚于首次渲染挂载（`usageBillingOf(c)` 先返回 undefined）。 */
  billing: UsageBillingRemote | undefined
  /** 视图状态由 `apply` 按 fiber 创建并传入（订阅式，不是模块级单例）。 */
  store: BillingStore
}

export function EntryCard(props: EntryCardProps): JSX.Element {
  const { wide, billing, store } = props
  // 订阅 store：点击卡片 / 关闭按钮改状态后本组件（以及仪表盘）会重渲染。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const includeSubagents = state.includeSubagents
  const [overview, setOverview] = useState<Overview | null>(null)
  const [todayKey, setTodayKey] = useState('')
  const [days, setDays] = useState<DailyPoint[]>([])
  const [pricingDegraded, setPricingDegraded] = useState(false)

  useEffect(() => {
    // 远程命名空间在 apply 里异步挂载；若本卡先渲染，`billing` 还是 undefined，
    // 直接调 `billing.overview(...)` 会在 async IIFE 里抛错 → unhandled rejection，
    // 卡片永远停在占位。缺席即早退，等 billing 变化后 effect 重跑。
    if (billing === undefined) return
    let alive = true
    void (async () => {
      const [o, d, p] = await Promise.all([
        billing.overview('month', includeSubagents),
        billing.daily('7d', includeSubagents),
        billing.pricing(),
      ])
      if (!alive) return
      if (o.ok) {
        setOverview(o.value.overview)
        setTodayKey(o.value.todayKey)
      }
      if (d.ok) setDays(d.value.days)
      if (p.ok) setPricingDegraded(p.value.usdToCnySource === 'default')
    })()
    return () => { alive = false }
  }, [billing, includeSubagents])

  const spark = useMemo(
    () => sparklinePoints(days.map((d) => d.costCny), 56, 16),
    [days],
  )

  // 一行都没定价（totalCny 为 0 且存在未收录模型）时，金额同样是不可信的 0。
  const entirelyUnpriced = overview !== null
    && overview.totalCny === 0
    && overview.unpricedModels.length > 0
  const priced = overview !== null && !entirelyUnpriced
  const amountText = priced ? formatCny(overview.totalCny) : PENDING
  const todayText = priced ? formatCny(overview.todayCny) : PENDING

  return (
    <button
      type="button"
      data-dsh-usage-billing
      data-dsh-ub-entry
      data-wide={String(wide)}
      title="计费"
      aria-label="计费"
      onClick={() => store.togglePanel()}
    >
      <span data-dsh-ub-entry-text>
        <span data-dsh-ub-amount>{amountText}</span>
        <span data-dsh-ub-sub>
          {formatDay(todayKey)} 今日 {todayText}
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
