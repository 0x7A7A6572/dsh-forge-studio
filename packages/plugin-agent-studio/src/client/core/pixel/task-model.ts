/**
 * 共享任务板投影的纯映射：agentTeam.tasks → 详情卡「共享任务」行。
 * 与官方 Team 面板同口径（ownerName 归属、状态文案）；纯函数，不 import react。
 */
import type { StudioStateDot } from './detail-model.ts'

/** 官方 TeamTaskStatus；deleted 只在持久层出现，客户端仍按四态渲染。 */
export type StudioSharedTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/**
 * agentTeam 投影里一条任务的最小切片（TeamTaskView）。
 * 只声明本面板读取的字段，其余字段（description/blockedBy/…）不参与渲染。
 */
export interface StudioSharedTaskProjection {
  readonly id: string
  readonly subject: string
  readonly status: StudioSharedTaskStatus
  readonly ownerName?: string
  readonly ready?: boolean
  readonly writeScopes?: readonly string[]
}

export interface StudioTaskRow {
  readonly taskId: string
  readonly subject: string
  readonly status: StudioSharedTaskStatus
  readonly statusText: string
  readonly dot: StudioStateDot
  /** 仅 lead 卡显示；成员卡过滤后不再需要 owner。 */
  readonly ownerName?: string
  readonly writeScopes: readonly string[]
}

export const SHARED_TASK_STATUS_TEXT: Readonly<Record<StudioSharedTaskStatus, string>> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  deleted: '已删除',
}

/** 任务态 → StateDot：进行中 ongoing、完成 done；待处理按 ready 区分 idle/warning；已删除按 idle。 */
export function sharedTaskDotOf(status: StudioSharedTaskStatus, ready?: boolean): StudioStateDot {
  switch (status) {
    case 'in_progress':
      return 'ongoing'
    case 'completed':
      return 'done'
    case 'pending':
      return ready === false ? 'warning' : 'idle'
    default:
      return 'idle'
  }
}

export interface StudioTaskRowsInput {
  readonly tasks?: readonly StudioSharedTaskProjection[]
  /** 成员卡按 ownerName 过滤时用；lead 卡传 showAll。 */
  readonly ownerName?: string
  readonly showAll?: boolean
}

/**
 * 共享任务行：lead 卡全量（带 owner），成员卡只保留 ownerName 相同的任务。
 * 无 owner 的任务（未分配）只出现在 lead 卡上。
 */
export function mapSharedTaskRows(input: StudioTaskRowsInput): readonly StudioTaskRow[] {
  const rows: StudioTaskRow[] = []
  for (const task of input.tasks ?? []) {
    if (input.showAll !== true && task.ownerName !== input.ownerName) continue
    rows.push({
      taskId: task.id,
      subject: task.subject,
      status: task.status,
      statusText: SHARED_TASK_STATUS_TEXT[task.status],
      dot: sharedTaskDotOf(task.status, task.ready),
      ...(input.showAll === true && task.ownerName !== undefined
        ? { ownerName: task.ownerName }
        : {}),
      writeScopes: task.writeScopes ?? [],
    })
  }
  return rows
}

/** 未分配任务的 owner 文案。 */
export const UNASSIGNED_TASK_OWNER_TEXT = '未分配'
