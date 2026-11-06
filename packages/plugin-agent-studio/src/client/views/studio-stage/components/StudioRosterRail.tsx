/**
 * 成员侧栏（§7 卡 4）：可访问信息源——头像/名字/角色/状态/模型/失败原因，10 人可滚动。
 * 选中成员高亮，与场景热区同一选中态。
 */
import type { StudioStageModel } from '../../../core/pixel/scene-types.ts'
import { PixelAvatar } from '../../../components/PixelAvatar.tsx'
import styles from './StudioRosterRail.module.css'

/** 成员名 → 头像（profile.id + 配色档）；不在册的名字（模拟成员）按 memberId 兜底。 */
export type StudioRailAvatars = Readonly<Record<string, { readonly id: string; readonly color?: number }>>

const STATE_TEXT: Record<string, string> = {
  working: '运行中',
  idle: '空闲',
  done: '刚完成',
  error: '失败',
  provisioning: '启动中',
}

const STATE_ORDER: Record<string, number> = {
  error: 0,
  provisioning: 1,
  working: 2,
  done: 3,
  idle: 4,
}

function sortKey(occupant: { role: string; visual: string }): string {
  return `${occupant.role === 'lead' ? 0 : 1}:${STATE_ORDER[occupant.visual] ?? 9}`
}

export function StudioRosterRail(
  { model, selectedId, avatars }: {
    model: StudioStageModel
    selectedId: string | null
    avatars?: StudioRailAvatars | undefined
  },
): JSX.Element {
  const rows = [...model.occupants, ...model.overflowMembers, ...model.roamers].sort((a, b) => {
    const byKind = sortKey(a).localeCompare(sortKey(b))
    return byKind !== 0 ? byKind : a.name.localeCompare(b.name)
  })
  const overflowCount = model.overflowMembers.length
  // 溢出容量读 slot.capacity（不硬编码 2）。
  const overflowCapacity = model.overflowMembers[0]?.slot.capacity ?? 0
  return (
    <aside className={styles.rail} aria-label="团队成员">
      <ul className={styles.list}>
        {rows.map((occupant) => {
          const avatar = avatars?.[occupant.name] ?? { id: occupant.memberId }
          return (
            <li
              key={occupant.memberId}
              className={styles.row}
              data-state={occupant.visual}
              data-selected={occupant.memberId === selectedId ? 'true' : undefined}
              aria-current={occupant.memberId === selectedId ? 'true' : undefined}
            >
              <span className={styles.avatar}>
                <PixelAvatar id={avatar.id} size={16} color={avatar.color} />
              </span>
              <span className={styles.name}>{occupant.name}</span>
              <span className={styles.role}>{occupant.role === 'lead' ? '队长' : '成员'}</span>
              <span className={styles.state}>{STATE_TEXT[occupant.visual] ?? occupant.visual}</span>
              <span className={styles.model}>{occupant.model ?? '继承模型'}</span>
              {occupant.error !== undefined && <span className={styles.failReason}>{occupant.error}</span>}
              {occupant.character.reused === true && <span className={styles.reuse}>复用角色</span>}
            </li>
          )
        })}
      </ul>
      {overflowCount > overflowCapacity && (
        <p className={styles.overflowNote}>候客区已满，其余 {overflowCount - overflowCapacity} 人仅在列表显示。</p>
      )}
    </aside>
  )
}
