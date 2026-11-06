/**
 * 成员详情的纯映射：脚底→覆盖层百分比、catalog 行、角色/状态/工位文案。
 * 与官方 Team 面板同口径；纯函数，不 import react。
 */
import type { PixelPoint, StudioSlot, StudioVisualState } from './scene-types.ts'
import {
  SUBAGENT_ACTIVITY_TEXT,
  activityDurationMs,
  formatDuration,
  formatTokenUsage,
  subagentActivityOf,
  subagentModeText,
  type StudioCatalogMode,
  type StudioSubagentActivity,
  type StudioSubagentActivityState,
  type StudioSubagentTiming,
  type StudioTokenUsage,
} from './text-format.ts'

/** 详情卡读到的成员档案快照（host 只拉一次，缺失显示 —）。 */
export interface StudioMemberProfileSnapshot {
  readonly description?: string
  readonly provider?: string
  readonly model?: string
}

/** StateDot 的语义态（结构对齐 primitives 的 StateDotState）。 */
export type StudioStateDot = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

/** 热区尺寸（画布逻辑像素）：覆盖躯干，不与相邻工位重叠。 */
export const HOTSPOT_WIDTH_PX = 18
export const HOTSPOT_HEIGHT_PX = 28

export interface StudioPercentRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** 脚底锚点 → 覆盖层百分比矩形：水平居中、底边贴脚底。 */
export function hotspotRectOf(
  foot: PixelPoint,
  canvas: { readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number } = {
    width: HOTSPOT_WIDTH_PX,
    height: HOTSPOT_HEIGHT_PX,
  },
): StudioPercentRect {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }
  return {
    left: ((foot.x - size.width / 2) / canvas.width) * 100,
    top: ((foot.y - size.height) / canvas.height) * 100,
    width: (size.width / canvas.width) * 100,
    height: (size.height / canvas.height) * 100,
  }
}

export interface StudioMemberStatusView {
  readonly dot: StudioStateDot
  readonly text: string
}

/** 成员视觉态 → 点色 + 文案（与侧栏同一套词）。 */
export function memberStatusOf(visual: StudioVisualState): StudioMemberStatusView {
  switch (visual) {
    case 'working':
      return { dot: 'ongoing', text: '运行中' }
    case 'done':
      return { dot: 'done', text: '刚完成' }
    case 'error':
      return { dot: 'error', text: '失败' }
    case 'provisioning':
      return { dot: 'warning', text: '启动中' }
    default:
      return { dot: 'idle', text: '空闲' }
  }
}

export function memberRoleTextOf(role: 'lead' | 'member'): string {
  return role === 'lead' ? '队长' : '成员'
}

/** 工位文案：游走 = 没占工位，溢出位是候客区，lead 位是接待台，座位号去掉 `seat-` 前缀。 */
export function workstationTextOf(slot: Pick<StudioSlot, 'id' | 'role'>): string {
  if (slot.id === 'roaming') return '游走中'
  if (slot.id === 'overflow') return '候客区'
  if (slot.role === 'lead') return '接待台'
  return slot.id.startsWith('seat-') ? slot.id.slice('seat-'.length) : slot.id
}

/** 任务态 → StateDot 语义态。 */
export function subagentDotOf(activity: StudioSubagentActivityState): StudioStateDot {
  if (activity === 'running') return 'ongoing'
  return activity === 'completed' ? 'done' : 'idle'
}

/** subagentCatalog 元素（dsh-subagent 的 SubagentCatalogEntry 最小切片）。 */
export interface StudioCatalogEntry {
  readonly id: string
  readonly mode: StudioCatalogMode
  readonly label?: string
}

/** 子会话 byId 行里详情卡读取的字段。 */
export interface StudioCatalogSummary {
  readonly title?: string
  readonly running?: boolean
  readonly projectionValues?: {
    readonly tokenUsage?: StudioTokenUsage
    readonly subagentTiming?: StudioSubagentTiming
  }
}

export interface StudioRunningStatusView {
  get(id: string): { readonly running?: boolean } | undefined
}

export type StudioCatalogPhase = 'loading' | 'ready' | 'error'

export interface StudioCatalogInput {
  readonly entries?: readonly StudioCatalogEntry[]
  /** projectionsBySession[memberId].state；缺省按 idle 处理。 */
  readonly state?: string
  readonly errorMessage?: string
  readonly summaries?: Readonly<Record<string, StudioCatalogSummary | undefined>>
  readonly statuses?: StudioRunningStatusView
  readonly now: number
}

export interface StudioCatalogRow {
  readonly id: string
  readonly label: string
  readonly title?: string
  readonly mode: StudioCatalogMode
  readonly activity: StudioSubagentActivityState
  readonly activityText: string
  readonly secondary: string
  readonly tokensText?: string
  readonly durationText?: string
  /** external 执行没有本地子会话，不能跳转。 */
  readonly openable: boolean
}

export interface StudioCatalogView {
  readonly phase: StudioCatalogPhase
  readonly errorMessage?: string
  readonly running: boolean
  readonly rows: readonly StudioCatalogRow[]
}

/** idle 下 values 已存在即视为读过（空数组也算就绪）；error 优先。 */
export function catalogPhaseOf(
  entries: readonly StudioCatalogEntry[] | undefined,
  state: string | undefined,
): StudioCatalogPhase {
  if (state === 'error' || state === 'migration-required') return 'error'
  if (state === 'loading') return 'loading'
  if (state === 'ready') return 'ready'
  return entries === undefined ? 'loading' : 'ready'
}

/** 目录项 + 子会话快照 → 任务行；缺失字段一律留空由视图显示 —。 */
export function mapCatalogRows(input: StudioCatalogInput): StudioCatalogView {
  const rows = (input.entries ?? []).map((entry): StudioCatalogRow => {
    const summary = input.summaries?.[entry.id]
    const values = summary?.projectionValues
    const activity: StudioSubagentActivity =
      (input.statuses?.get(entry.id)?.running ?? summary?.running) === true ? 'running' : 'inactive'
    const state = subagentActivityOf(activity, values?.subagentTiming?.lastTurnCompleted)
    const activityText = SUBAGENT_ACTIVITY_TEXT[state]
    const tokensText = formatTokenUsage(values?.tokenUsage)
    const durationMs = activityDurationMs(values?.subagentTiming, activity, input.now)
    return {
      id: entry.id,
      // 回退顺序：catalog label → 子会话 title → 子会话 id。
      label: entry.label ?? summary?.title ?? entry.id,
      ...(summary?.title !== undefined ? { title: summary.title } : {}),
      mode: entry.mode,
      activity: state,
      activityText,
      secondary: [summary?.title, subagentModeText(entry.mode), activityText]
        .filter((value) => value !== undefined && value !== '')
        .join(' · '),
      ...(tokensText !== undefined ? { tokensText } : {}),
      ...(durationMs !== undefined ? { durationText: formatDuration(durationMs) } : {}),
      openable: entry.mode !== 'external',
    }
  })
  const phase = catalogPhaseOf(input.entries, input.state)
  return {
    phase,
    ...(phase === 'error' && input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
    running: rows.some((row) => row.activity === 'running'),
    rows,
  }
}
