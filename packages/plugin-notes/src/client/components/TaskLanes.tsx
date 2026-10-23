/**
 * 任务看板：列 = lane.status（core/task-lanes），列底是层级令牌的浅面板，卡片中性底。
 * 换列 = HTML5 拖放，同列放下无操作；归档便签不进看板（由 BoardMain 引导切纸卡墙）。
 */

import { useMemo, useState } from 'react'
import type { NoteId, NoteRecord } from '../../types.ts'
import { groupNotesByLane, type TaskStatus } from '../core/task-lanes.ts'
import { TaskLaneCard } from './TaskLaneCard.tsx'
import { t } from '../core/theme-tokens.ts'
import { Plus } from 'lucide-react'
import styles from '../styles/notes-board.module.css'

export interface TaskLanesProps {
  /** 已分区/已排序/已搜索的活动便签（看板内不再懒加载分批）。 */
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
  /** 卡片上设置/清除截止日期。 */
  readonly onSetDue: (note: NoteRecord, dueAt: number | undefined) => void
  readonly onToggleSchedule: (note: NoteRecord) => void
}

/** 列头状态点的色：只借状态语义，不跟纸色走。 */
const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: 'var(--dsw-alias-label-tertiary)',
  todo: 'var(--dsw-alias-label-secondary)',
  running: 'var(--dsw-alias-state-business-primary)',
  done: 'var(--dsw-alias-state-success-primary)',
  failed: 'var(--dsw-alias-state-error-primary)',
}

export function TaskLanes(props: TaskLanesProps): JSX.Element {
  const lanes = useMemo(() => groupNotesByLane(props.notes), [props.notes])
  // 当前被拖拽经过的列（高亮投放目标）。
  const [dropOver, setDropOver] = useState<TaskStatus | null>(null)
  const notesById = useMemo(() => new Map(props.notes.map((note) => [note.id, note])), [props.notes])

  return (
    <div style={lanesStyle} data-dsh-part="lanes" aria-label="任务看板">
      {lanes.map((lane) => {
        const count = lane.notes.length
        const dropping = dropOver === lane.status
        return (
          <section
            key={lane.status}
            data-dsh-part="lane"
            data-dropping={dropping}
            className={styles.lane}
            style={{
              ...laneStyle,
              ...(dropping ? { boxShadow: `inset 0 0 0 1.5px ${t.pinAccent}` } : {}),
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
              <i style={{ ...statusDot, background: STATUS_DOT[lane.status] }} aria-hidden="true" />
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
              <div style={laneEmptyStyle}>暂无事项</div>
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
                    onSetDue={(dueAt) => props.onSetDue(note, dueAt)}
                    onToggleSchedule={() => props.onToggleSchedule(note)}
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
  gridAutoColumns: 'minmax(280px, 1fr)',
  gap: 10,
  overflowX: 'auto',
  overflowY: 'hidden',
  padding: '2px 0',
}
const laneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  height: '100%',
  boxSizing: 'border-box',
  borderRadius: 12,
  overflow: 'hidden',
}
const laneHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '10px 10px 8px',
  flex: 'none',
}
const statusDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 4,
  flex: 'none',
  display: 'inline-block',
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
  fontSize: 12,
  color: t.labelTertiary,
  fontVariantNumeric: 'tabular-nums',
}
const laneAddBtn: React.CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
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
  gap: 6,
  overflowY: 'auto',
}
const laneEmptyStyle: React.CSSProperties = {
  flex: 1,
  margin: '0 8px 8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px dashed ${t.borderL2}`,
  borderRadius: 8,
  color: t.labelTertiary,
  fontSize: 12,
}
