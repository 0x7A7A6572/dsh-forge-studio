/**
 * 任务标识小徽章（纸卡墙 grid / 行式列表 list 共用）：在便签与任务混排的视图里
 * 区分「任务便签」与普通便签 —— 便签含 lane 即任务（见 core/task-lanes.ts），
 * 泳道视图内全是任务无需再标。
 *
 * 形态：主题色小胶囊 + 状态中文；running 常驻呼吸圆点提示执行中；done 用 ✓ 弱化，
 * failed 用 ✗ 警示（错误色）。颜色走宿主主题令牌，明暗主题下都成立；全部内联样式。
 * 呼吸动画 keyframes 由 notes-board.module.css 的 .taskLiveDot 提供。
 */

import type { NoteLane } from '../../types.ts'
import { laneLabel, isRunOpen } from '../core/task-lanes.ts'
import { t } from '../core/theme-tokens.ts'
import styles from '../styles/notes-board.module.css'

export interface TaskBadgeProps {
  readonly lane: NoteLane
}

export function TaskBadge(props: TaskBadgeProps): JSX.Element {
  const { lane } = props
  const running = lane.status === 'running' && isRunOpen(lane)
  const failed = lane.status === 'failed'
  const done = lane.status === 'done'
  const label = laneLabel(lane.status)
  const started = lane.run?.startedAt
  const tip = running
    ? `任务执行中（${started ? '开始于 ' + new Date(started).toLocaleString() : '已投递'}）`
    : failed
      ? '任务已失败'
      : done
        ? '任务已完成'
        : `任务·${label}`
  return (
    <span
      role="img"
      aria-label={`任务·${label}`}
      title={tip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        flex: 'none',
        height: 17,
        padding: '0 6px',
        boxSizing: 'border-box',
        borderRadius: 9,
        fontSize: 10.5,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
        color: failed ? t.danger : t.labelSecondary,
        background: failed ? t.hoverDangerBg : t.hoverBg,
      }}
    >
      {running && (
        <span
          className={styles.taskLiveDot}
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: 3, background: t.labelSecondary }}
        />
      )}
      {done && <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>✓</span>}
      {failed && <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>✗</span>}
      {label}
    </span>
  )
}
