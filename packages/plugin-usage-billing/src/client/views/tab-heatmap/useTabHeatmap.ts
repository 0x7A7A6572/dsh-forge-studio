/** 热力图取数：一次 daily('all')，回填标记随响应一起回来（不再单独取 overview）。 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { BillingStore } from '../../core/store.ts'
import type { DailyPoint } from '../../../view.ts'

/** 金额与披露标记同源：都来自这一次 `daily` 响应。 */
export interface HeatPayload {
  days: DailyPoint[]
  hasBackfilled: boolean
  unpricedModels: string[]
}

export interface TabHeatmapProps {
  billing: UsageBillingRemote | undefined
  store: BillingStore
}

export function useTabHeatmap(props: TabHeatmapProps) {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [data, setData] = useState<HeatPayload | null>(null)

  useEffect(() => {
    if (billing === undefined) return
    let alive = true
    void billing.daily('all', state.includeSubagents).then((r) => {
      if (!alive) return
      if (r.ok) {
        setData({ days: r.value.days, hasBackfilled: r.value.hasBackfilled, unpricedModels: r.value.unpricedModels })
      } else {
        // host 报错不是「没有用量」：停在「正在读取用量…」并留日志（不伪造色阶）。
        console.warn('[usage-billing] 热力图取数失败', r.error)
      }
    }).catch((error: unknown) => {
      // wire 层 reject 同理：保持占位，绝不伪造一个零金额。
      console.warn('[usage-billing] 热力图通道异常', error)
    })
    return () => { alive = false }
  }, [billing, state.includeSubagents])

  return { data }
}
