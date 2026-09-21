/** 热力图：日历色阶（5 档）+ 活跃天数 / 连续天数。 */
import {
  NON_FINITE_PLACEHOLDER, backfilledDisclosure, formatCny, isUnpricedTotal,
} from '../../core/format.ts'
import { activeDays, longestStreak } from '../../core/token-stats.ts'
import { Card } from '../../components/Card.tsx'
import { StatCard } from '../../components/StatCard.tsx'
import { HeatChart } from '../../components/HeatChart.tsx'
import { HeatLegend } from '../../components/HeatLegend.tsx'
import { useTabHeatmap } from './useTabHeatmap.ts'
import type { TabHeatmapProps } from './useTabHeatmap.ts'
import styles from '../../styles/settings-section.module.css'

export function TabHeatmap(props: TabHeatmapProps): JSX.Element {
  const { data } = useTabHeatmap(props)

  if (data === null) return <div className={styles.empty} data-dsh-ub-empty>正在读取用量…</div>
  if (data.days.length === 0) return <div className={styles.empty} data-dsh-ub-empty>这个范围里还没有用量记录。</div>

  const active = activeDays(data.days)
  const hasBackfilled = backfilledDisclosure(data.hasBackfilled)
  // 唯一判据：整份账未定价时色阶里的金额同样不可信（每一格都是 0），格子提示统一占位。
  const unpriced = isUnpricedTotal(data.days.reduce((a, d) => a + d.costCny, 0), data.unpricedModels)

  return (
    <div className={styles.section} data-dsh-usage-billing>
      <div className={styles.stats}>
        <StatCard label="活跃天数" value={active + ' 天'} hint={'共 ' + data.days.length + ' 天'} />
        <StatCard label="最长连续天数" value={longestStreak(data.days) + ' 天'} />
        <StatCard label="区间合计" value={unpriced ? NON_FINITE_PLACEHOLDER : formatCny(
          data.days.reduce((a, d) => a + d.costCny, 0),
        )} />
        {hasBackfilled ? <StatCard label="口径" value="含安装前估算" hint="按安装时点价表估算" /> : null}
      </div>

      <Card title="每日费用" desc="色阶按当日费用分 5 档；悬停看当天金额。">
        <HeatChart days={data.days} unpriced={unpriced} />
        <div className={styles.activityFoot}>
          <HeatLegend />
        </div>
      </Card>
    </div>
  )
}
