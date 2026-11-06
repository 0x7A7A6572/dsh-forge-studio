/**
 * 点击热区层：每位可见成员一个透明按钮，选中者同一层画描边。
 * 位置全部走内联百分比（core/pixel/detail-model.ts 的 hotspotRectOf）。
 */
import { Fragment, type CSSProperties } from 'react'
import type { StudioStageModel } from '../../../core/pixel/scene-types.ts'
import { hotspotRectOf, memberStatusOf, type StudioPercentRect } from '../../../core/pixel/detail-model.ts'
import styles from './StudioHotspots.module.css'

export interface StudioHotspotsProps {
  readonly model: StudioStageModel
  readonly selectedId: string | null
  onSelect(memberId: string, trigger: HTMLElement): void
}

function styleOf(rect: StudioPercentRect): CSSProperties {
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  }
}

export function StudioHotspots({ model, selectedId, onSelect }: StudioHotspotsProps): JSX.Element {
  const { width, height } = model.scene.canvas
  const overflowCapacity = model.overflowMembers[0]?.slot.capacity ?? 0
  const visible = [
    ...model.occupants,
    ...model.overflowMembers.slice(0, overflowCapacity),
    ...model.roamers,
  ]
  return (
    <div className={styles.layer}>
      {visible.map((occupant) => {
        const rect = hotspotRectOf(occupant.foot, { width, height })
        const selected = occupant.memberId === selectedId
        return (
          <Fragment key={occupant.memberId}>
            {selected && <span className={styles.outline} style={styleOf(rect)} aria-hidden="true" />}
            <button
              type="button"
              className={styles.hotspot}
              style={styleOf(rect)}
              aria-label={`查看 ${occupant.name} 详情，${memberStatusOf(occupant.visual).text}`}
              aria-pressed={selected}
              onClick={(event) => onSelect(occupant.memberId, event.currentTarget)}
            />
          </Fragment>
        )
      })}
    </div>
  )
}
