/**
 * 今日消耗分布条：整条 = 今日合计（所有项目），两段从左到右 = 本项目今日 / 其他项目今日。
 *
 * 与预算条（BudgetStackBar）不是一个东西，别合并：预算条的分母是**预算**、里面还叠着三轴
 * 指标；这里没有预算，整条就是今天这一天，所以两段是**并排铺满**而不是叠放 —— 补集关系由
 * 调用方保证（其他项目 = 今日合计 − 本项目），这里只管几何与颜色。
 *
 * 颜色不在组件里写死：由样式表的 [data-kind] 规则决定，与入口卡上那三段同一套变量。
 */
import type { PopoverSegment } from '../hooks/useEntryCard.ts'
import styles from '../styles/settings-section.module.css'

export interface TodayStackBarProps {
  /** 今日三段（workspace / others / today）；未知（null）按 0 处理，即不画这一段。 */
  segments: readonly PopoverSegment[]
}

/** 一段占今日总额的百分比；总额为 0 时全部按 0（空条）。 */
function pct(value: number | null, total: number): number {
  if (value === null || !Number.isFinite(value) || total <= 0) return 0
  return Math.min(Math.max(value, 0) / total, 1) * 100
}

export function TodayStackBar(props: TodayStackBarProps): JSX.Element {
  const valueOf = (key: PopoverSegment['key']): number | null =>
    props.segments.find((s) => s.key === key)?.value ?? null
  const total = valueOf('today') ?? 0
  const project = pct(valueOf('workspace'), total)
  // 其他项目是补集：两段相加恰好 100%，不会因为各自的四舍五入在条上露出缝或重叠。
  const others = Math.max(100 - project, 0)
  return (
    <span className={styles.todayBar} data-dsh-ub-today-bar aria-hidden="true">
      {project <= 0 ? null : (
        <span className={styles.todayPiece} data-kind="workspace" style={{ width: project.toFixed(2) + '%' }} />
      )}
      {others <= 0 ? null : (
        <span className={styles.todayPiece} data-kind="others" style={{ width: others.toFixed(2) + '%' }} />
      )}
    </span>
  )
}
