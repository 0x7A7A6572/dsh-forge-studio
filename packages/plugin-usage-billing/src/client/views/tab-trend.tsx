/**
 * 趋势：7/30 天（跟随 store.range），费用 ↔ Token 切换。
 *
 * 图从手绘柱子换成 echarts（见 trend-chart.tsx）；柱子下面另给一张逐日表 ——
 * 图表回答「形状」，表格回答「到底多少」，两件事本来就不该挤在同一屏的同一个控件里。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { buildTrendOption } from '../core/trend-option.ts'
import type { TrendPoint } from '../core/trend-option.ts'
import { DataTable } from './components/data-table.tsx'
import type { DataTableColumn } from './components/data-table.tsx'
import { Card } from './components/kit.tsx'
import { TrendChart } from './trend-chart.tsx'
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

  if (data === null) return <div className="ub-empty" data-dsh-ub-empty>正在读取用量…</div>
  if (data.days.length === 0) return <div className="ub-empty" data-dsh-ub-empty>这个范围里还没有用量记录。</div>

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
  // tooltip 与表格同一口径：费用走 money（含未定价占位），Token 走 formatInt。
  const formatValue = (n: number): string => tokenMetric ? formatInt(n) : money(n)
  const points: TrendPoint[] = data.days.map((d, i) => ({ day: d.day, value: values[i] ?? 0 }))
  const labels = data.days.map((d) => formatDay(d.day))

  const columns: ReadonlyArray<DataTableColumn<DailyPoint>> = [
    { key: 'day', header: '日期', main: true, render: (d) => d.day },
    { key: 'calls', header: '调用', align: 'right', render: (d) => formatInt(d.calls) },
    {
      key: 'tokens',
      // 列头不能只写 'Token'：与上面那个指标 Pill 的文本完全一样，
      // 同一屏里两个同名元素对读屏和测试都是歧义。
      header: 'Token 用量',
      align: 'right',
      render: (d) => formatInt(d.input + d.cacheRead + d.cacheWrite + d.output),
    },
    { key: 'cost', header: '费用', align: 'right', render: (d) => money(d.costCny) },
  ]

  return (
    <div className="ub-section" data-dsh-usage-billing>
      <div className="ub-field">
        <div className="ub-tabs" role="group" aria-label="时间范围">
          {(['7d', '30d'] as const).map((r) => (
            <Pill key={r} active={state.range === r} onClick={() => store.setRange(r)}>
              {r === '7d' ? '近 7 天' : '近 30 天'}
            </Pill>
          ))}
        </div>
        <div className="ub-tabs" role="group" aria-label="指标">
          {(['cost', 'token'] as const).map((m) => (
            <Pill key={m} active={state.metric === m} onClick={() => store.setMetric(m)}>
              {m === 'cost' ? '费用' : 'Token'}
            </Pill>
          ))}
        </div>
        {hasBackfilled ? <span className="ub-estimate" data-dsh-ub-estimate>含安装前估算</span> : null}
        <span className="ub-sub" style={{ marginLeft: 'auto' }}>
          合计 {tokenMetric ? formatInt(values.reduce((a, b) => a + b, 0)) + ' tok' : money(totalCost)}
        </span>
      </div>

      <TrendChart
        option={buildTrendOption({
          points,
          formatDay,
          formatValue,
          // 30 天的柱子会挤成一排细线：超过 14 天改用折线。
          line: points.length > 14,
        })}
        fallback={{ values, labels, formatValue }}
      />

      <Card title="逐日明细">
        <DataTable
          columns={columns}
          // 倒序：最近的一天在最上面（与图表从左到右的时间顺序互补）。
          rows={[...data.days].reverse()}
          rowKey={(d) => d.day}
        />
      </Card>
    </div>
  )
}
