/** 热力图：日历色阶（5 档）+ 活跃天数 / 连续天数。 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { calendarMatrix } from '../core/heatmap.ts'
import {
  NON_FINITE_PLACEHOLDER, backfilledDisclosure, formatCny, isUnpricedTotal,
} from '../core/format.ts'
import { Card, StatCard } from './components/kit.tsx'
import type { DailyPoint } from '../../view.ts'

function longestStreak(days: readonly DailyPoint[]): number {
  let best = 0; let cur = 0
  for (const d of days) {
    cur = d.calls > 0 ? cur + 1 : 0
    if (cur > best) best = cur
  }
  return best
}

/** 金额与披露标记同源：都来自这一次 `daily` 响应。 */
interface HeatPayload {
  days: DailyPoint[]
  hasBackfilled: boolean
  unpricedModels: string[]
}

export function TabHeatmap(props: {
  billing: UsageBillingRemote | undefined
  store: BillingStore
}): JSX.Element {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [data, setData] = useState<HeatPayload | null>(null)

  useEffect(() => {
    if (billing === undefined) return
    let alive = true
    // 一次取数：回填标记随 daily 一起回来，不再单独取 overview。
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

  const matrix = useMemo(() => data === null ? [] : calendarMatrix(
    data.days.map((d) => d.day),
    new Map(data.days.map((d) => [d.day, d.costCny])),
    { firstDayOfWeek: 1 },
  ), [data])

  if (data === null) return <div className="ub-empty" data-dsh-ub-empty>正在读取用量…</div>
  if (data.days.length === 0) return <div className="ub-empty" data-dsh-ub-empty>这个范围里还没有用量记录。</div>

  const active = data.days.filter((d) => d.calls > 0).length
  const hasBackfilled = backfilledDisclosure(data.hasBackfilled)
  // 唯一判据：整份账未定价时色阶里的金额同样不可信（每一格都是 0），格子提示统一占位。
  const unpriced = isUnpricedTotal(data.days.reduce((a, d) => a + d.costCny, 0), data.unpricedModels)

  return (
    <div className="ub-section" data-dsh-usage-billing>
      <div className="ub-stats">
        <StatCard label="活跃天数" value={active + ' 天'} hint={'共 ' + data.days.length + ' 天'} />
        <StatCard label="最长连续天数" value={longestStreak(data.days) + ' 天'} />
        <StatCard label="区间合计" value={unpriced ? NON_FINITE_PLACEHOLDER : formatCny(
          data.days.reduce((a, d) => a + d.costCny, 0),
        )} />
        {hasBackfilled ? <StatCard label="口径" value="含安装前估算" hint="按安装时点价表估算" /> : null}
      </div>

      <Card title="每日费用" desc="色阶按当日费用分 5 档；悬停看当天金额。">
        <div className="ub-heat" data-dsh-ub-heat>
          {matrix.flat().map((cell, i) => (
            <span
              key={cell?.day ?? `pad-${i}`}
              data-level={cell?.level ?? 0}
              title={cell === null ? '' : `${cell.day}：${unpriced ? NON_FINITE_PLACEHOLDER : formatCny(cell.value)}`}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}
