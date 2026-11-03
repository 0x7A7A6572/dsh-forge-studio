/**
 * 子智能体任务的文本格式化：token、活跃时长、状态与模式文案。
 * 公式对齐官方 Team 面板；纯函数，不 import react。
 */

/** 四个互斥的 provider 用量桶（dsh-token-meter 的 TokenUsage）。 */
export interface StudioTokenUsage {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** subagentTiming 投影的最小切片；时间为 epoch 毫秒。 */
export interface StudioSubagentTiming {
  readonly settledMs: number
  readonly active?: { readonly since: number; readonly through: number }
  readonly lastTurnCompleted?: boolean
}

/** 目录行的原始运行态（status store 缺失时回退 byId.running）。 */
export type StudioSubagentActivity = 'running' | 'inactive'

/** 合成后的任务态：completed 需要 inactive + 上一回合正常结束。 */
export type StudioSubagentActivityState = 'running' | 'completed' | 'inactive'

/** subagentCatalog 元素的模式。 */
export type StudioCatalogMode = 'continuable' | 'one-shot' | 'external' | 'unknown'

/** 四桶求和；undefined 表示没有用量数据。 */
export function tokenTotal(usage: StudioTokenUsage | undefined): number | undefined {
  if (usage === undefined) return undefined
  return usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** 官方 formatTokens：<1e3 原样；K/M 后 ≥100 取整，否则保留一位小数。 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  const scaled = (next: number): string =>
    next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10)
  if (value < 1e3) return String(value)
  if (value < 1e6) return `${scaled(value / 1e3)}K`
  return `${scaled(value / 1e6)}M`
}

/** 令牌指标：合计 + ' tok'；没有用量返回 undefined（视图显示 —）。 */
export function formatTokenUsage(usage: StudioTokenUsage | undefined): string | undefined {
  const total = tokenTotal(usage)
  return total === undefined ? undefined : `${formatTokens(total)} tok`
}

/** 活跃时长：settled + 当前打开区间；running 取 now，否则取区间闭合的 through。 */
export function activityDurationMs(
  timing: StudioSubagentTiming | undefined,
  activity: StudioSubagentActivity,
  now: number,
): number | undefined {
  if (timing === undefined) return undefined
  const active = timing.active
  if (active === undefined) return timing.settledMs
  const end = activity === 'running' ? now : active.through
  return timing.settledMs + Math.max(0, end - active.since)
}

/** 「X小时Y分」/「X分YY秒」/「YY秒」；分钟以上的秒补零，>1h 不再带秒。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}小时${minutes}分`
  return minutes > 0 ? `${minutes}分${String(seconds).padStart(2, '0')}秒` : `${seconds}秒`
}

/** running 优先；inactive 且上一回合正常结束才算 completed。 */
export function subagentActivityOf(
  activity: StudioSubagentActivity,
  lastTurnCompleted: boolean | undefined,
): StudioSubagentActivityState {
  if (activity === 'running') return 'running'
  return lastTurnCompleted === true ? 'completed' : 'inactive'
}

export const SUBAGENT_ACTIVITY_TEXT: Readonly<Record<StudioSubagentActivityState, string>> = {
  running: '正在运行',
  completed: '已完成',
  inactive: '当前未运行',
}

export function subagentModeText(mode: StudioCatalogMode): string {
  if (mode === 'continuable') return '可继续'
  if (mode === 'one-shot') return '一次性'
  return '模式未知'
}
