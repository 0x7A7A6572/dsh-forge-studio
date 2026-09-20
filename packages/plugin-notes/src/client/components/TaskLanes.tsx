/**
 * 任务泳道视图（五列看板，布局参考 dsh-task-board 的多列 kanban）：
 * - 列 = 任务状态（待规划/待办/进行中/已完成/已失败），列成员资格 = 便签
 *   内嵌 lane 的 status（见 core/task-lanes.ts），本组件只读便签、不改数据；
 * - 横向五列：容器横向滚动，列内卡片区纵向滚动；列头 = 中文标签 + 计数
 *   （无状态点，纸色不再表状态），空列给占位提示；
 * - 换列 = HTML5 拖放：卡片 dragstart 写入 note.id，目标列 onDrop 回调
 *   onMove(noteId, status)（同列放下无操作），由 board-view 落
 *   notes.update({ lane: { status } }) 并刷新；
 * - 只有带 lane 的任务便签进泳道，普通便签与归档便签不进（归档即离开工作流，
 *   由 BoardMain 提示切列表管理）。
 * 类选择器样式见 styles/notes-board.module.css 的 .laneCards（各组件导入同一份 CSS Module）。
 */

import { useMemo, useState } from 'react'
import type { NoteId, NoteRecord } from '../../types.ts'
import {
  groupNotesByLane,
  type TaskStatus,
} from '../core/task-lanes.ts'
import { TaskLaneCard } from './TaskLaneCard.tsx'
import { t } from '../core/theme-tokens.ts'
import { Plus } from 'lucide-react'
import styles from '../styles/notes-board.module.css'

export interface TaskLanesProps {
  /** 已分区/已排序/已搜索的活动便签（泳道内不再懒加载分批）。 */
  readonly notes: readonly NoteRecord[]
  readonly busy: boolean
  readonly onEdit: (note: NoteRecord) => void
  readonly onTogglePin: (note: NoteRecord) => void
  readonly onToggleArchive: (note: NoteRecord) => void
  readonly onRemove: (note: NoteRecord) => void
  /** 拖拽换列：目标状态 ≠ 当前 lane.status 时才触发。 */
  readonly onMove: (noteId: NoteId, status: TaskStatus) => void
  /** 执行/重跑（非 running 卡主入口）。 */
  readonly onExecute: (note: NoteRecord) => void
  /** 重置为待办（running 卡主入口，手动接管）。 */
  readonly onReset: (note: NoteRecord) => void
  /** 列头「＋」新建任务：初始 lane.status = 该列状态。 */
  readonly onCreateTask: (status: TaskStatus) => void
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
            data-dsh-part="lane"
            data-dropping={dropping}
            style={{
              ...laneStyle,
              // 拖拽高亮淡入淡出（inline，避免被内联 background 覆盖失效）。
              transition: 'box-shadow 160ms ease, background-color 160ms ease',
              ...(dropping
                ? { background: t.hoverBg, boxShadow: 'inset 0 0 0 2px var(--dsw-alias-state-business-primary)' }
                : {}),
            }}
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
              // 同列（lane.status 一致）放下 = 无操作，不触发无谓写入。
              if (dropped.lane?.status === lane.status) return
              props.onMove(noteId, lane.status)
            }}
          >
            <header style={laneHeaderStyle}>
              <h3 style={laneTitleStyle}>{lane.label}</h3>
              <span style={laneCountStyle}>{count}</span>
              <button
                type="button"
                title={`在「${lane.label}」列新建任务`}
                aria-label={`在「${lane.label}」列新建任务`}
                disabled={props.busy}
                onClick={() => props.onCreateTask(lane.status)}
                style={{ ...laneAddBtn, ...(props.busy ? laneAddBtnDisabled : {}) }}
              >
                <Plus size={13} />
              </button>
            </header>
            {count === 0 ? (
              <div style={laneEmptyStyle}>此列暂无便签</div>
            ) : (
              <ul className={styles.laneCards} style={laneListStyle}>
                {lane.notes.map((note) => (
                  <TaskLaneCard
                    key={note.id}
                    note={note}
                    busy={props.busy}
                    onEdit={() => props.onEdit(note)}
                    onTogglePin={() => props.onTogglePin(note)}
                    onToggleArchive={() => props.onToggleArchive(note)}
                    onRemove={() => props.onRemove(note)}
                    onExecute={() => props.onExecute(note)}
                    onReset={() => props.onReset(note)}
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
const laneAddBtn: React.CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: t.labelSecondary,
  cursor: 'pointer',
}
const laneAddBtnDisabled: React.CSSProperties = {
  opacity: 0.45,
  cursor: 'default',
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
