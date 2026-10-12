/**
 * 任务泳道纯语义：按便签内嵌 lane 对象（存在即任务）的 status 分列，与纸色彻底解耦。
 * 全部为纯函数 / 常量，无副作用、不触 DOM / 服务。
 */

import type {
  NoteLane,
  NoteModelSelection,
  NoteRecord,
  TaskModelGroup,
  TaskStatus,
} from '../../types.ts'

// 转发导出以兼容旧 import 路径。
export type { TaskStatus } from '../../types.ts'

export interface TaskLaneDef {
  readonly status: TaskStatus
  readonly label: string
}

/** 数组顺序即看板列顺序。 */
export const TASK_LANES: readonly TaskLaneDef[] = [
  { status: 'backlog', label: '待规划' },
  { status: 'todo', label: '待办' },
  { status: 'running', label: '进行中' },
  { status: 'done', label: '已完成' },
  { status: 'failed', label: '已失败' },
]

const laneByStatus = new Map(TASK_LANES.map((lane) => [lane.status, lane]))

/** 未知状态兜底待办列。 */
export function laneLabel(status: TaskStatus): string {
  return laneByStatus.get(status)?.label ?? TASK_LANES[1]!.label
}

export interface TaskLaneGroup extends TaskLaneDef {
  /** 保持传入顺序，排序由调用方负责。 */
  readonly notes: readonly NoteRecord[]
}

/**
 * 按 `note.lane.status` 分进五列，每列恒存在（空列 notes=[]）。
 * 只有带 lane 的便签才进列，无 lane 的普通便签不进任何列。
 */
export function groupNotesByLane(notes: readonly NoteRecord[]): TaskLaneGroup[] {
  return TASK_LANES.map((lane) => ({
    ...lane,
    notes: notes.filter((note) => note.lane?.status === lane.status),
  }))
}

export function makeLane(status: TaskStatus): NoteLane {
  return { status }
}

/** 置 running 并开新帧（重跑时覆盖旧帧）；by 供 host 超时兜底认领定时发起的 run。 */
export function beginRun(_lane: NoteLane, startedAt: number, by: 'user' | 'schedule' = 'user'): NoteLane {
  return { status: 'running', run: { startedAt, by } }
}

/** 补 finishedAt/ok/summary；lane 无 run 时先按 at 造帧。 */
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

export function isRunOpen(lane: NoteLane): boolean {
  return Boolean(lane.run && lane.run.finishedAt === undefined)
}

/** preset 空串 = 用宿主默认预设；model 缺省 = 用宿主默认模型。 */
export interface TaskTargetDraft {
  readonly agentPreset: string
  readonly model?: NoteModelSelection
}

/** 是 `NoteUpdateInput.lane` 的子集。 */
export interface LanePatch {
  readonly status?: TaskStatus
  readonly agentPreset?: string
  readonly model?: NoteModelSelection | null
  /** 取消任务：删掉 lane 身份，与其余字段互斥。 */
  readonly clear?: true
}

/** reasoningEffort 缺省与空串等价。 */
function sameModel(
  left: NoteModelSelection | undefined,
  right: NoteModelSelection | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.reasoningEffort ?? '') === (right.reasoningEffort ?? '')
  )
}

/**
 * 「设为任务」开关 → 保存时的 lane patch 决策。未变的字段一律不带，
 * 免得编辑器打开期间的陈旧快照把宿主已 settle 的最新状态静默回滚；
 * 开关从开变关 = `{ clear: true }`。
 */
export function lanePatchForSave(
  on: boolean,
  status: TaskStatus,
  current: NoteLane | undefined,
  target?: TaskTargetDraft,
): LanePatch | undefined {
  if (!on) return current !== undefined ? { clear: true } : undefined
  const patch: {
    status?: TaskStatus
    agentPreset?: string
    model?: NoteModelSelection | null
  } = {}
  if (current?.status !== status) patch.status = status
  if (target !== undefined) {
    const preset = target.agentPreset.trim()
    if (preset !== (current?.agentPreset ?? '')) patch.agentPreset = preset
    if (!sameModel(target.model, current?.model)) patch.model = target.model ?? null
  }
  return Object.keys(patch).length === 0 ? undefined : patch
}

/** select 的 value 分隔符：provider / model id 里不可能出现的控制字符。 */
const MODEL_KEY_SEP = '\u0001'

export function modelKey(model: NoteModelSelection | undefined): string {
  return model === undefined ? '' : model.provider + MODEL_KEY_SEP + model.model
}

export function parseModelKey(key: string): NoteModelSelection | undefined {
  if (key === '') return undefined
  const index = key.indexOf(MODEL_KEY_SEP)
  if (index <= 0 || index === key.length - 1) return undefined
  return { provider: key.slice(0, index), model: key.slice(index + 1) }
}

export interface ModelOption {
  readonly key: string
  readonly label: string
}

export interface ModelOptionGroup {
  readonly id: string
  readonly label: string
  readonly options: readonly ModelOption[]
}

/**
 * 当前值不在目录里时补进它所属的 provider 组：不补的话 select 会显示空白，
 * 用户一保存就把旧值静默抹掉。
 */
export function modelSelectGroups(
  groups: readonly TaskModelGroup[],
  current: NoteModelSelection | undefined,
): readonly ModelOptionGroup[] {
  const projected = groups.map((group) => ({
    id: group.id,
    label: group.name,
    options: group.models.map((entry) => ({
      key: modelKey({ provider: group.id, model: entry.id }),
      label: entry.name,
    })),
  }))
  if (current === undefined) return projected
  const key = modelKey(current)
  if (projected.some((group) => group.options.some((option) => option.key === key))) return projected
  const label = current.model + '（不在当前目录）'
  const host = projected.find((group) => group.id === current.provider)
  if (host !== undefined) {
    return projected.map((group) =>
      group.id === current.provider
        ? { ...group, options: [...group.options, { key, label }] }
        : group,
    )
  }
  return [...projected, { id: current.provider, label: current.provider, options: [{ key, label }] }]
}

/** 新建路径没有「未变」可言；preset 空串 / model 缺省都不落字段。 */
export function taskTargetCreateInput(
  target: TaskTargetDraft,
): { readonly agentPreset?: string; readonly model?: NoteModelSelection } {
  const preset = target.agentPreset.trim()
  return {
    ...(preset !== '' ? { agentPreset: preset } : {}),
    ...(target.model !== undefined ? { model: target.model } : {}),
  }
}

/** 侧栏徽标口径：未归档且状态 ∈ {待办, 进行中}。 */
export function countOpenTasks(notes: readonly NoteRecord[]): number {
  let open = 0
  for (const note of notes) {
    if (note.archived) continue
    const status = note.lane?.status
    if (status === 'todo' || status === 'running') open += 1
  }
  return open
}
