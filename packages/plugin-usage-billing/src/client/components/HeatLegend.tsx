/**
 * 色阶图例（少 → 多）。
 *
 * 与降级矩阵、echarts 的 visualMap 共用同一条 5 档色阶：档位定义只有 heatmap.ts 的
 * HEAT_SCALE 一处，颜色只有样式表一处，这里只摆 5 个方块。
 */
import styles from '../styles/settings-section.module.css'

export function HeatLegend(): JSX.Element {
  return (
    <span className={styles.heatlegend} data-dsh-ub-heat-legend aria-hidden="true">
      <span className={styles.heatlegendLabel}>少</span>
      {[0, 1, 2, 3, 4].map((level) => (
        <i key={level} className={styles.heatlegendSwatch} data-level={level} />
      ))}
      <span className={styles.heatlegendLabel}>多</span>
    </span>
  )
}
