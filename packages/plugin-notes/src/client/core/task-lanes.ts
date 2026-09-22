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

import type {
  NoteLane,
  NoteModelSelection,
  NoteRecord,
  TaskModelGroup,
  TaskStatus,
} from '../../types.ts'

// TaskStatus 已迁至 types.ts；此处转发导出以兼容旧 import（BoardMain/NotesBoard）。
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

/**
 * 开新 run 帧：置 running，run = { startedAt, by }（重跑时新帧覆盖旧帧）。
 * by 记录发起方（定时调度自动派发 / 用户点执行），供 host 超时兜底只收拾定时发起的 run。
 */
export function beginRun(_lane: NoteLane, startedAt: number, by: 'user' | 'schedule' = 'user'): NoteLane {
  return { status: 'running', run: { startedAt, by } }
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
 * 编辑器里的执行目标草稿：preset 空串 = 用宿主默认预设；model 缺省 = 用宿主默认模型。
 * 保存时经 lanePatchForSave / taskTargetCreateInput 折算成落库入参。
 */
export interface TaskTargetDraft {
  readonly agentPreset: string
  readonly model?: NoteModelSelection
}

/** lane patch 的形状（与 types.ts 的 NoteUpdateInput.lane 对齐的子集）。 */
export interface LanePatch {
  readonly status?: TaskStatus
  readonly agentPreset?: string
  readonly model?: NoteModelSelection | null
  /** 取消任务：删掉 lane 身份（与 status/agentPreset/model 互斥）。 */
  readonly clear?: true
}

/** 两个模型选择是否等价（reasoningEffort 缺省与空串等价）。 */
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
 * 编辑器「设为任务」开关 → 保存时的 lane patch 决策（M2）：
 * - 开关开且状态相较既有 lane 已改 → 带 status（含「普通便签转任务」与「任务改状态」）；
 * - 开关开但状态未改 → 不带 status（避免编辑器打开期间陈旧快照把宿主已 settle /
 *   已执行的最新状态静默回滚；running 只读时也走此分支，正文保存不含 lane）；
 * - 开关开且执行目标变了 → 带 agentPreset（空串 = 清除）/ model（null = 清除）；
 *   两处都是「未变即不带」，同样是为了不覆盖宿主已写回的值；
 * - 开关开且三项都没变 → undefined（纯内容更新）；
 * - 开关关且原本是任务 → `{ clear: true }`（取消任务，删除 lane 身份）；
 * - 开关关且原本非任务 → undefined。
 *
 * 纯函数，供 board-view.saveDraft 的编辑路径复用与单测。`target` 缺省 = 不参与
 * 决策（旧调用点语义原样保留）。
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

/* ---------- 模型下拉的取值编解码 + 选项投影 ---------- */

/**
 * select 的 value 分隔符：provider / model id 里不可能出现的控制字符。
 * 下拉只承载「选哪个」，不需要人类可读，故不拼成 "provider/model"（model id 自带斜杠）。
 */
const MODEL_KEY_SEP = '\u0001'

/** 模型选择 → 下拉 value（undefined = 宿主默认 = 空串）。 */
export function modelKey(model: NoteModelSelection | undefined): string {
  return model === undefined ? '' : model.provider + MODEL_KEY_SEP + model.model
}

/** 下拉 value → 模型选择（空串 / 形状不对 = undefined = 宿主默认）。 */
export function parseModelKey(key: string): NoteModelSelection | undefined {
  if (key === '') return undefined
  const index = key.indexOf(MODEL_KEY_SEP)
  if (index <= 0 || index === key.length - 1) return undefined
  return { provider: key.slice(0, index), model: key.slice(index + 1) }
}

/** 模型下拉里的一个选项。 */
export interface ModelOption {
  readonly key: string
  readonly label: string
}

/** 模型下拉的一组（provider）。 */
export interface ModelOptionGroup {
  readonly id: string
  readonly label: string
  readonly options: readonly ModelOption[]
}

/**
 * 模型下拉的选项投影：目录分组原样搬过来；**当前值不在目录里时补进它所属的
 * provider 组**（该 provider 整组都不在目录里就补一个独立组）——不补的话 select 会因为
 * 没有匹配项而显示空白，用户一保存就把旧值静默抹掉（与工作区下拉同一条教训）。
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

/**
 * 执行目标 → 新建任务的 create 入参（新建路径没有「未变」可言，一律显式给）：
 * preset 空串不落字段（缺省即宿主默认）；model 缺省不落字段。
 */
export function taskTargetCreateInput(
  target: TaskTargetDraft,
): { readonly agentPreset?: string; readonly model?: NoteModelSelection } {
  const preset = target.agentPreset.trim()
  return {
    ...(preset !== '' ? { agentPreset: preset } : {}),
    ...(target.model !== undefined ? { model: target.model } : {}),
  }
}

/**
 * 侧栏「活动待办」徽标口径：未归档且泳道状态 ∈ {待办, 进行中} 的任务便签数。
 * （待规划是计划池、已完成/已失败已离开工作流，均不计；普通便签无 lane 不计。）
 */
export function countOpenTasks(notes: readonly NoteRecord[]): number {
  let open = 0
  for (const note of notes) {
    if (note.archived) continue
    const status = note.lane?.status
    if (status === 'todo' || status === 'running') open += 1
  }
  return open
}