/**
 * L4 DOM 覆盖层（§5.3）：名字与状态文字同行共一枚药丸，按锚点百分比定位，不挡点击。
 * 文字放 DOM 不进 canvas：中文可读、可访问、随宿主字号缩放；状态衬在药丸底上（可读性）。
 */
import type { StudioOccupant, StudioStageModel } from '../../../core/pixel/scene-types.ts'
import { labelAnchorOf } from '../../../core/pixel/labels.ts'
import styles from './StudioOverlayLabels.module.css'

const STATE_TEXT: Record<StudioOccupant['visual'], string> = {
  working: '运行中',
  idle: '空闲',
  done: '刚完成',
  error: '失败',
  provisioning: '启动中',
}

export function StudioOverlayLabels({ model }: { model: StudioStageModel }): JSX.Element {
  const { width, height } = model.scene.canvas
  // 溢出容量读 slot.capacity（不硬编码 2）；游走成员随 foot 显示。
  const overflowCapacity = model.overflowMembers[0]?.slot.capacity ?? 0
  const visible = [
    ...model.occupants,
    ...model.overflowMembers.slice(0, overflowCapacity),
    ...model.roamers,
  ]
  return (
    <div className={styles.layer} aria-hidden="true">
      {visible.map((occupant) => {
        // 标签贴实时头顶（公式在 core/pixel/labels.ts）：随游走/归位移动。
        const anchor = labelAnchorOf(occupant)
        return (
          <div
            key={occupant.memberId}
            className={styles.label}
            style={{
              left: `${(anchor.x / width) * 100}%`,
              top: `${(anchor.y / height) * 100}%`,
            }}
          >
            <span className={styles.name}>{occupant.name}</span>
            <span className={styles.state} data-state={occupant.visual}>
              {STATE_TEXT[occupant.visual]}
            </span>
          </div>
        )
      })}
    </div>
  )
}
