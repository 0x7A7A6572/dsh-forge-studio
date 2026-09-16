/** 趋势：7/30 天（跟随 store.range），费用 ↔ Token 切换。 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { BarChart } from './chart.tsx'
import {
  NON_FINITE_PLACEHOLDER, backfilledDisclosure, formatCny, formatDay, formatInt, isUnpricedTotal,
} from '../core/format.ts'
import type { DailyPoint } from '../../view.ts'

/** 金额与披露标记**同源**：来自同一次 `daily` 响应，不存在「金额在、标记没了」的时间窗。 */
interface TrendPayload {
  days: DailyPoint[]
  hasBackfilled: boolean
  unpricedModels: string[]
}

export function TabTrend(props: {
  billing: UsageBillingRemote | undefined
  store: BillingStore
}): JSX.Element {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [data, setData] = useState<TrendPayload | null>(null)

  useEffect(() => {
    // 远程面首帧可能未挂载：缺席即早退，等 billing 到位后 effect 重跑（不会调 undefined.xxx）。
    if (billing === undefined) return
    let alive = true
    // 只取一次：回填标记是 daily 响应自带的字段，不再第二次取 overview
    // （那次取数失败会让披露静默消失，而金额照常渲染）。
    void billing.daily(state.range, state.includeSubagents).then((r) => {
      if (!alive) return
      if (r.ok) {
        setData({ days: r.value.days, hasBackfilled: r.value.hasBackfilled, unpricedModels: r.value.unpricedModels })
      } else {
        // host 报错不是「没有花费」：停在「正在读取用量…」（无标记的金额绝不出现）并留日志。
        console.warn('[usage-billing] 趋势取数失败', r.error)
      }
    }).catch((error: unknown) => {
      // wire 层 reject 同理：保持占位，绝不伪造一个零金额。
      console.warn('[usage-billing] 趋势通道异常', error)
    })
    return () => { alive = false }
  }, [billing, state.range, state.includeSubagents])

  if (data === null) return <div data-dsh-ub-empty>正在读取用量…</div>
  if (data.days.length === 0) return <div data-dsh-ub-empty>这个范围里还没有用量记录。</div>

  // 响应产不出来时 data 恒为 null，页面停在「正在读取用量…」，绝不会出现「无标记的金额」；
  // 标记本身再走一次保守兜底（缺席 = present），双保险，永不弱化披露。
  const hasBackfilled = backfilledDisclosure(data.hasBackfilled)
  const tokenMetric = state.metric === 'token'
  const values = data.days.map((d) => tokenMetric
    ? d.input + d.cacheRead + d.cacheWrite + d.output
    : d.costCny)
  const totalCost = data.days.reduce((a, d) => a + d.costCny, 0)
  // 唯一判据：整份账未定价时，本分区的金额（合计与每日行）一律占位。
  const unpriced = isUnpricedTotal(totalCost, data.unpricedModels)
  const money = (n: number): string => unpriced ? NON_FINITE_PLACEHOLDER : formatCny(n)

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
          合计 {tokenMetric ? formatInt(values.reduce((a, b) => a + b, 0)) + ' tok' : money(totalCost)}
        </span>
      </div>
      <BarChart values={values} labels={data.days.map((d) => formatDay(d.day))} width={960} height={180} />
      <ul data-dsh-ub-sub style={{ marginTop: 10 }}>
        {[...data.days].reverse().slice(0, 7).map((d) => (
          <li key={d.day}>{d.day} · {money(d.costCny)} · {formatInt(d.calls)} 次调用</li>
        ))}
      </ul>
    </div>
  )
}
