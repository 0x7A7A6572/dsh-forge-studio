/** 概览：Hero 本月费用 + 环比 + 预计 + KPI + 预算条 + 未收录提示 + 回填角标。 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import type { BillingScope } from '../core/config.ts'
import { evaluateBudget } from '../../budget.ts'
import {
  NON_FINITE_PLACEHOLDER, backfilledDisclosure, formatCny, formatInt, formatPct, isUnpricedTotal,
} from '../core/format.ts'
import type { Overview } from '../../view.ts'

export function TabOverview(props: {
  /** 远程面首帧可能未挂载（`$mount` 异步且失败只 warn）：类型如实写出，effect 早退。 */
  billing: UsageBillingRemote | undefined
  store: BillingStore
  /** 显示偏好（`display.showUnpricedWarning`）读宿主设置；订阅，改完立即生效。 */
  scope: BillingScope
}): JSX.Element {
  const { billing, store, scope } = props
  // 必须订阅（不订阅的话切范围/切子代理口径不会重取数据）：与 Dashboard / 入口卡同一姿态。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const showUnpricedWarning = settings.value?.display?.showUnpricedWarning !== false
  const [data, setData] = useState<{ overview: Overview; budget: { enabled: boolean; monthlyCny: number } } | null>(null)

  useEffect(() => {
    if (billing === undefined) return
    let alive = true
    void billing.overview(state.range, state.includeSubagents).then((r) => {
      if (!alive) return
      if (r.ok) setData({ overview: r.value.overview, budget: r.value.budget })
      // host 报错（!ok）不是「花了 0 元」：停在「正在读取用量…」并留下日志。
      else console.warn('[usage-billing] 概览取数失败', r.error)
    }).catch((error: unknown) => {
      // wire 层 reject 同理（与入口卡同一处理）：保持占位，绝不伪造一个零金额。
      console.warn('[usage-billing] 概览通道异常', error)
    })
    return () => { alive = false }
  }, [billing, state.range, state.includeSubagents])

  if (data === null) return <div data-dsh-ub-empty>正在读取用量…</div>
  const { overview, budget } = data
  // 唯一判据（client/core/format.ts）：整份账一行都没定价时，本分区的金额级数字
  // （Hero、今日/本周、日均）都显示占位，绝不把「未知」读成「没花钱」。判据只在
  // `totalCny === 0 且存在未收录模型` 时成立 —— 此时今日/本周这些**子集**里的 0 同样是
  // 未知（有记录但一条都没算钱），不是真实零；真实零（无未收录模型）仍旧走 formatCny。
  const unpriced = isUnpricedTotal(overview.totalCny, overview.unpricedModels)
  const money = (n: number): string => unpriced ? NON_FINITE_PLACEHOLDER : formatCny(n)
  const spend = evaluateBudget({
    spentCny: overview.totalCny, monthlyCny: budget.monthlyCny,
    enabled: budget.enabled, notified: {}, monthKey: new Date().toISOString().slice(0, 7),
  })

  return (
    <div data-dsh-usage-billing>
      <div data-dsh-ub-hero>{money(overview.totalCny)}</div>
      <div data-dsh-ub-sub>
        当前范围合计 · 今日 {money(overview.todayCny)} · 本周 {money(overview.weekCny)}
        {/* 标记与金额同源（同一次 overview 响应）；缺席按 present 处理，与另外三个分区同一保守口径。 */}
        {backfilledDisclosure(overview.hasBackfilled) ? <span data-dsh-ub-estimate> · 含安装前估算</span> : null}
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
        <div data-dsh-ub-kpi><div data-dsh-ub-sub>日均</div><div>{money(overview.avgDailyCny)}</div></div>
        <div data-dsh-ub-kpi><div data-dsh-ub-sub>调用次数</div><div>{formatInt(overview.calls)}</div></div>
        <div data-dsh-ub-kpi><div data-dsh-ub-sub>缓存命中率</div><div>{formatPct(overview.cacheHitRate)}</div></div>
        <div data-dsh-ub-kpi>
          <div data-dsh-ub-sub>未收录模型</div>
          <div>{overview.unpricedModels.length === 0 ? '0' : `${overview.unpricedModels.length} 未收录`}</div>
        </div>
      </section>

      {/* 未收录提示条是**可关的偏好**（display.showUnpricedWarning）；上面的 KPI 计数与徽标
          是事实，不受该开关影响 —— 关掉的只是这条解释性文案。 */}
      {overview.unpricedModels.length > 0 && showUnpricedWarning ? (
        <p data-dsh-ub-estimate>
          {overview.unpricedRows} 条记录涉及 {overview.unpricedModels.length} 个未收录模型（
          {overview.unpricedModels.slice(0, 3).join('、')}），已按 ¥0 计但未静默忽略 —— 到「费率」页补单价即可。
        </p>
      ) : null}
    </div>
  )
}
