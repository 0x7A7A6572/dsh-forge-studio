/**
 * 任务泳道视图（五列看板，布局参考 dsh-task-board 的多列 kanban）：
 * - 列 = 任务状态（待规划/待办/进行中/已完成/已失败），纸色即状态（见
 *   core/task-lanes.ts），本组件只读便签、不改数据；
 * - 横向五列：容器横向滚动，列内卡片区纵向滚动；列头 = 该状态纸色点 +
 *   中文标签 + 计数，空列给占位提示；
 * - 换列 = HTML5 拖放：卡片 dragstart 写入 note.id，目标列 onDrop 回调
 *   onMove(noteId, status)（同列放下无操作），由 board-view 落
 *   notes.update({ color }) 并刷新；
 * - 归档便签不进泳道（归档即离开工作流，由 board-main 提示切列表管理）。
 * 类选择器样式见导出的 LANES_CSS（由 board-main 统一注入一次 <style>）。
 */

import { useMemo, useState } from 'react'
import type { NoteColor, NoteId, NoteRecord } from '../../types.ts'
import { noteColorMeta } from '../core/note-colors.ts'
import {
  groupNotesByLane,
  statusForColor,
  type TaskStatus,
} from '../core/task-lanes.ts'
import { TaskLaneCard } from './task-lane-card.tsx'
import { t } from '../core/theme-tokens.ts'

/** 拖拽经过列的高亮与列内滚动条。 */
export const LANES_CSS = `
.fs-note-lane[data-dropping='true'] {
  box-shadow: inset 0 0 0 2px var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.fs-note-lane-cards::-webkit-scrollbar { width: 8px; }
.fs-note-lane-cards::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l3); border-radius: 4px; }
.fs-note-lane-cards::-webkit-scrollbar-track { background: transparent; }
`

export interface TaskLanesProps {
  /** 已分区/已排序/已搜索的活动便签（泳道内不再懒加载分批）。 */
  readonly notes: readonly NoteRecord[]
  readonly busy: boolean
  readonly onEdit: (note: NoteRecord) => void
  readonly onTogglePin: (note: NoteRecord) => void
  readonly onToggleArchive: (note: NoteRecord) => void
  readonly onRemove: (note: NoteRecord) => void
  /** 拖拽换列：目标状态 ≠ 当前纸色状态时才触发。 */
  readonly onMove: (noteId: NoteId, status: TaskStatus) => void
}

/** 泳道列头的状态点纸色（暗示「改纸色即换列」）。 */
function StatusDot({ color }: { color: NoteColor }): JSX.Element {
  const meta = noteColorMeta(color)
  return (
    <span
      aria-hidden="true"
      style={{
        flex: 'none',
        width: 10,
        height: 10,
        borderRadius: 3,
        background: meta.paper,
        border: `1px solid ${meta.ring}`,
      }}
    />
  )
}

export function TaskLanes(props: TaskLanesProps): JSX.Element {
  const lanes = useMemo(() => groupNotesByLane(props.notes), [props.notes])
  // 当前被拖拽经过的列（高亮投放目标）。
  const [dropOver, setDropOver] = useState<TaskStatus | null>(null)
  const notesById = useMemo(
    () => new Map(props.notes.map((note) => [note.id, note])),
    [props.notes],
  )

  return (
    <div
      style={lanesStyle}
      data-dsh-part="lanes"
      aria-label="任务泳道"
    >
      {lanes.map((lane) => {
        const count = lane.notes.length
        const dropping = dropOver === lane.status
        return (
          <section
            key={lane.status}
            className="fs-note-lane"
            data-dropping={dropping}
            style={laneStyle}
            aria-label={`${lane.label}（${count} 张便签）`}
            onDragEnter={(e) => {
              e.preventDefault()
              setDropOver(lane.status)
            }}
            onDragOver={(e) => {
              // busy 时拒绝投放（防与执行中的更新竞争）。
              if (props.busy) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDragLeave={(e) => {
              // 离开整个列（而非进入子元素）才清除高亮。
              const related = e.relatedTarget
              if (!(related instanceof Node) || !e.currentTarget.contains(related)) {
                setDropOver((prev) => (prev === lane.status ? null : prev))
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDropOver((prev) => (prev === lane.status ? null : prev))
              if (props.busy) return
              const noteId = e.dataTransfer.getData('text/plain') as NoteId | ''
              if (!noteId) return
              const dropped = notesById.get(noteId)
              if (!dropped) return
              // 同列（纸色状态一致）放下 = 无操作，不触发无谓写入。
              if (statusForColor(dropped.color) === lane.status) return
              props.onMove(noteId, lane.status)
            }}
          >
            <header style={laneHeaderStyle}>
              <StatusDot color={lane.color} />
              <h3 style={laneTitleStyle}>{lane.label}</h3>
              <span style={laneCountStyle}>{count}</span>
            </header>
            {count === 0 ? (
              <div style={laneEmptyStyle}>此列暂无便签</div>
            ) : (
              <ul className="fs-note-lane-cards" style={laneListStyle}>
                {lane.notes.map((note) => (
                  <TaskLaneCard
                    key={note.id}
                    note={note}
                    busy={props.busy}
                    onEdit={() => props.onEdit(note)}
                    onTogglePin={() => props.onTogglePin(note)}
                    onToggleArchive={() => props.onToggleArchive(note)}
                    onRemove={() => props.onRemove(note)}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

/* ---------- 样式 ---------- */

const lanesStyle: React.CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(210px, 1fr)',
  gap: 10,
  overflowX: 'auto',
  overflowY: 'hidden',
  padding: '6px 4px 2px 0',
}
const laneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  height: '100%',
  boxSizing: 'border-box',
  borderRadius: 12,
  border: `1px solid ${t.borderL1}`,
  background: 'var(--dsw-alias-bg-base)',
  overflow: 'hidden',
}
const laneHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '9px 11px 7px',
  flex: 'none',
}
const laneTitleStyle: React.CSSProperties = {
  margin: 0,
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  fontWeight: 600,
  color: t.labelPrimary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const laneCountStyle: React.CSSProperties = {
  flex: 'none',
  minWidth: 20,
  height: 18,
  padding: '0 6px',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 9,
  fontSize: 11,
  color: t.labelSecondary,
  background: t.hoverBg,
}
const laneListStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  margin: 0,
  padding: '0 8px 8px',
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  overflowY: 'auto',
}
const laneEmptyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 10px 12px',
  color: t.labelTertiary,
  fontSize: 12,
}
