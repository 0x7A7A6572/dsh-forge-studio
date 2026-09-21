/**
 * 趋势页的取数：7/30 天跟随 store.range，口径跟随 store.includeSubagents。
 *
 * 只取一次 daily：回填标记是 daily 响应自带的字段，不再第二次取 overview
 * （那次取数失败会让披露静默消失，而金额照常渲染）。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { BillingStore } from '../../core/store.ts'
import type { DailyPoint } from '../../../view.ts'

/** 金额与披露标记**同源**：来自同一次 `daily` 响应，不存在「金额在、标记没了」的时间窗。 */
export interface TrendPayload {
  days: DailyPoint[]
  hasBackfilled: boolean
  unpricedModels: string[]
}

export interface TabTrendProps {
  billing: UsageBillingRemote | undefined
  store: BillingStore
}

export function useTabTrend(props: TabTrendProps) {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [data, setData] = useState<TrendPayload | null>(null)

  useEffect(() => {
    // 远程面首帧可能未挂载：缺席即早退，等 billing 到位后 effect 重跑（不会调 undefined.xxx）。
    if (billing === undefined) return
    let alive = true
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

  return { data, range: state.range, metric: state.metric, setRange: store.setRange, setMetric: store.setMetric }
}
