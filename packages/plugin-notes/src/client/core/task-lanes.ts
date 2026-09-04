/**
 * 任务泳道（便签任务化）纯语义：按便签内嵌 lane 对象（存在即任务）的 status
 * 分列，与纸色彻底解耦。
 *
 * 概念：任务身份 = 显式标记（NoteRecord.lane 存在即任务，缺省 undefined = 普通
 * 便签，不进泳道）。列间拖拽换列 = `notes.update({ lane: { status } })`；颜色
 * 只是卡片底色，不再表状态（旧颜色 ⇄ 状态的映射函数已删除）。
 *
 * 五列顺序对齐 dsh-task-board 看板：待规划→待办→进行中→已完成→已失败。
 * 全部为纯函数/常量（无副作用、不触 DOM/服务），便于单测。
 */

import type { NoteLane, NoteRecord, TaskStatus } from '../../types.ts'

// TaskStatus 已迁至 types.ts；此处转发导出以兼容旧 import（board-main/board-view）。
export type { TaskStatus } from '../../types.ts'

/** 泳道列定义：状态 id + 列头中文标签（颜色不再表状态）。 */
export interface TaskLaneDef {
  /** 状态 id（稳定，跨列拖拽/回调传递用）。 */
  readonly status: TaskStatus
  /** 列头中文标签。 */
  readonly label: string
}

/** 泳道定义表，数组顺序即看板列顺序。 */
export const TASK_LANES: readonly TaskLaneDef[] = [
  { status: 'backlog', label: '待规划' },
  { status: 'todo', label: '待办' },
  { status: 'running', label: '进行中' },
  { status: 'done', label: '已完成' },
  { status: 'failed', label: '已失败' },
]

const laneByStatus = new Map(TASK_LANES.map((lane) => [lane.status, lane]))

/** 状态 → 列头中文标签；未知状态兜底待办列（防御非法输入）。 */
export function laneLabel(status: TaskStatus): string {
  return laneByStatus.get(status)?.label ?? TASK_LANES[1]!.label
}

export interface TaskLaneGroup extends TaskLaneDef {
  /** 列内便签（保持传入顺序；主排序由调用方 partitionNotes/sortNotes 负责）。 */
  readonly notes: readonly NoteRecord[]
}

/**
 * 把（已排序的）活动便签按 `note.lane.status` 分进五列：每列恒存在（空列
 * notes=[]），组顺序 = TASK_LANES 列顺序。**只有带 lane 的便签（显式任务）**
 * 才进列，无 lane 的普通便签不进任何列。输入不应含归档便签（归档即离开工作流）。
 */
export function groupNotesByLane(notes: readonly NoteRecord[]): TaskLaneGroup[] {
  return TASK_LANES.map((lane) => ({
    ...lane,
    notes: notes.filter((note) => note.lane?.status === lane.status),
  }))
}

/** 新建任务 lane：仅含状态（无 run 帧）。 */
export function makeLane(status: TaskStatus): NoteLane {
  return { status }
}

/** 开新 run 帧：置 running，run = { startedAt }（重跑时新帧覆盖旧帧）。 */
export function beginRun(_lane: NoteLane, startedAt: number): NoteLane {
  return { status: 'running', run: { startedAt } }
}

/**
 * 收尾 run 帧：补 finishedAt/ok/summary；若 lane 无 run（缺省）则先按
 * `startedAt: at` 造帧（不炸）。
 */
export function settleRun(
  lane: NoteLane,
  ok: boolean,
  summary: string,
  at: number,
): NoteLane {
  return {
    ...lane,
    run: {
      ...(lane.run ?? { startedAt: at }),
      finishedAt: at,
      ok,
      summary,
    },
  }
}

/** run 是否仍在进行：有 run 且 finishedAt 未落。 */
export function isRunOpen(lane: NoteLane): boolean {
  return Boolean(lane.run && lane.run.finishedAt === undefined)
}

/**
 * 编辑器「设为任务」开关 → 保存时的 lane patch 决策（M2）：
 * - 开关开 → `{ status }`（开启任务 / 改状态，含「普通便签转任务」）；
 * - 开关关且原本是任务 → `{ clear: true }`（取消任务，删除 lane 身份）；
 * - 开关关且原本非任务 → undefined（纯内容更新，不改 lane）。
 * 纯函数，供 board-view.saveDraft 复用与单测。
 */
export function lanePatchForSave(
  on: boolean,
  status: TaskStatus,
  wasTask: boolean,
): { readonly status: TaskStatus } | { readonly clear: true } | undefined {
  if (on) return { status }
  if (wasTask) return { clear: true }
  return undefined
}
