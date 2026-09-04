/**
 * 任务泳道（便签任务化）纯语义：五列状态 ↔ 五色纸卡的双向映射与分列分组。
 *
 * 概念：任务状态是便签 color 的**派生视图**，color 仍是唯一真相（无新增存储
 * 字段）。列间拖拽换列 = `notes.update({ color: colorForStatus(target) })`；
 * 「切换状态 ⇔ 切换颜色」只发生在纸色这一处。
 *
 * 五列顺序对齐 dsh-task-board 看板：待规划→待办→进行中→已完成→已失败。
 * 全部为纯函数（无副作用、不触 DOM/服务），便于单测。
 *
 * 未来「可编辑分类」只需扩展/替换本文件的 TASK_LANES 表（状态、标签、纸色
 * 三元组），视图与存储层不动。
 */

import type { NoteColor, NoteRecord } from '../../types.ts'

/** 任务状态（与 dsh-task-board 五列语义一致，稳定 id 供拖拽/回调传递）。 */
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'done' | 'failed'

export interface TaskLaneDef {
  /** 状态 id（稳定，跨列拖拽/回调传递用）。 */
  readonly status: TaskStatus
  /** 列头中文标签。 */
  readonly label: string
  /** 本列纸色：便签换到本列 = 改为该色。 */
  readonly color: NoteColor
}

/** 泳道定义表，数组顺序即看板列顺序。 */
export const TASK_LANES: readonly TaskLaneDef[] = [
  { status: 'backlog', label: '待规划', color: 'gray' },
  { status: 'todo', label: '待办', color: 'yellow' },
  { status: 'running', label: '进行中', color: 'blue' },
  { status: 'done', label: '已完成', color: 'green' },
  { status: 'failed', label: '已失败', color: 'pink' },
]

const laneByStatus = new Map(TASK_LANES.map((lane) => [lane.status, lane]))
const laneByColor = new Map(TASK_LANES.map((lane) => [lane.color, lane]))

/** 状态 → 列定义；未知状态兜底待办列（防御非法输入）。 */
export function laneOf(status: TaskStatus): TaskLaneDef {
  return laneByStatus.get(status) ?? TASK_LANES[1]!
}

/**
 * 纸色 → 任务状态。NOTE_COLORS 已收敛为与五列一一对应的五色，理论恒命中；
 * 未命中（理论上仅出现在类型外的旧数据）兜底待办，保证总有一个列可归。
 */
export function statusForColor(color: NoteColor): TaskStatus {
  return laneByColor.get(color)?.status ?? 'todo'
}

/** 任务状态 → 纸色（换列写入便签时即用）；未知状态兜底默认黄。 */
export function colorForStatus(status: TaskStatus): NoteColor {
  return laneByStatus.get(status)?.color ?? 'yellow'
}

export interface TaskLaneGroup extends TaskLaneDef {
  /** 列内便签（保持传入顺序；主排序由调用方 partitionNotes/sortNotes 负责）。 */
  readonly notes: readonly NoteRecord[]
}

/**
 * 把（已排序的）活动便签按纸色分进五列：每列恒存在（空列 notes=[]），
 * 组顺序 = TASK_LANES 列顺序。输入不应含归档便签（归档即离开工作流）。
 */
export function groupNotesByLane(notes: readonly NoteRecord[]): TaskLaneGroup[] {
  return TASK_LANES.map((lane) => ({
    ...lane,
    notes: notes.filter((note) => statusForColor(note.color) === lane.status),
  }))
}
