/**
 * 趋势：7/30 天（跟随 store.range），费用 ↔ Token 切换。
 *
 * 图从手绘柱子换成 echarts（见 components/TrendChart.tsx）；柱子下面另给一张逐日表 ——
 * 图表回答「形状」，表格回答「到底多少」，两件事本来就不该挤在同一屏的同一个控件里。
 */
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { buildTrendOption } from '../../core/trend-option.ts'
import type { TrendPoint } from '../../core/trend-option.ts'
import {
  NON_FINITE_PLACEHOLDER, backfilledDisclosure, formatCny, formatDay, formatInt, isUnpricedTotal,
} from '../../core/format.ts'
import { Card } from '../../components/Card.tsx'
import { DataTable } from '../../components/DataTable.tsx'
import type { TableColumn } from '../../components/DataTable.tsx'
import { TrendChart } from '../../components/TrendChart.tsx'
import { useTabTrend } from './useTabTrend.ts'
import type { TabTrendProps } from './useTabTrend.ts'
import type { DailyPoint } from '../../../view.ts'
import styles from '../../styles/settings-section.module.css'

/** 过滤用的可搜索文本（模块级常量：身份稳定，列表的 memo 才不会每帧重算）。 */
const daySearch = (d: DailyPoint): string => d.day

export function TabTrend(props: TabTrendProps): JSX.Element {
  const { data, range, metric, setRange, setMetric } = useTabTrend(props)

  if (data === null) return <div className={styles.empty} data-dsh-ub-empty>正在读取用量…</div>
  if (data.days.length === 0) return <div className={styles.empty} data-dsh-ub-empty>这个范围里还没有用量记录。</div>

  // 响应产不出来时 data 恒为 null，页面停在「正在读取用量…」，绝不会出现「无标记的金额」；
  // 标记本身再走一次保守兜底（缺席 = present），双保险，永不弱化披露。
  const hasBackfilled = backfilledDisclosure(data.hasBackfilled)
  const tokenMetric = metric === 'token'
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

  const columns: ReadonlyArray<TableColumn<DailyPoint>> = [
    { key: 'day', header: '日期', main: true, sortValue: (d) => d.day, render: (d) => d.day },
    { key: 'calls', header: '调用', align: 'right', sortValue: (d) => d.calls, render: (d) => formatInt(d.calls) },
    {
      key: 'tokens',
      // 列头不能只写 'Token'：与上面那个指标 Pill 的文本完全一样，
      // 同一屏里两个同名元素对读屏和测试都是歧义。
      header: 'Token 用量',
      align: 'right',
      sortValue: (d) => d.input + d.cacheRead + d.cacheWrite + d.output,
      render: (d) => formatInt(d.input + d.cacheRead + d.cacheWrite + d.output),
    },
    { key: 'cost', header: '费用', align: 'right', sortValue: (d) => d.costCny, render: (d) => money(d.costCny) },
  ]

  return (
    <div className={styles.section} data-dsh-usage-billing>
      <div className={styles.field}>
        <div className={styles.tabs} role="group" aria-label="时间范围">
          {(['7d', '30d'] as const).map((r) => (
            <Pill key={r} active={range === r} onClick={() => { setRange(r) }}>
              {r === '7d' ? '近 7 天' : '近 30 天'}
            </Pill>
          ))}
        </div>
        <div className={styles.tabs} role="group" aria-label="指标">
          {(['cost', 'token'] as const).map((m) => (
            <Pill key={m} active={metric === m} onClick={() => { setMetric(m) }}>
              {m === 'cost' ? '费用' : 'Token'}
            </Pill>
          ))}
        </div>
        {hasBackfilled ? <span className={styles.estimate} data-dsh-ub-estimate>含安装前估算</span> : null}
        <span className={styles.sub + ' ' + styles.pushEnd}>
          合计 {tokenMetric ? formatInt(values.reduce((a, b) => a + b, 0)) + ' tok' : money(totalCost)}
        </span>
      </div>

      <TrendChart
        option={buildTrendOption({
          points,
          formatDay,
          formatValue,
          // 30 天的柱子会挤成一样细线：超过 14 天改用折线。
          line: points.length > 14,
        })}
        fallback={{ values, labels, formatValue }}
      />

      <Card title="逐日明细">
        <DataTable
          columns={columns}
          rows={data.days}
          rowKey={(d) => d.day}
          // 默认按日期倒序：最近的一天在最上面（与图表从左到右的时间顺序互补）。
          defaultSort={{ key: 'day', dir: 'desc' }}
          searchText={daySearch}
          filterPlaceholder="过滤日期"
        />
      </Card>
    </div>
  )
}
