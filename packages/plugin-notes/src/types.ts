import type { Branded } from '@deepseek-ai/dsh-brand'

export type NoteId = Branded<'NoteId'>

export const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'gray'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export const DEFAULT_NOTE_COLOR: NoteColor = 'yellow'

export function normalizeNoteColor(value: unknown): NoteColor | undefined {
  return (NOTE_COLORS as readonly string[]).includes(value as string)
    ? (value as NoteColor)
    : undefined
}

export type TaskStatus = 'backlog' | 'todo' | 'running' | 'done' | 'failed'

/**
 * 单次任务执行帧。`summary` 是短 markdown；`by` 缺省视同 'user'，
 * host 超时兜底只收 'schedule' 的 run。
 */
export interface NoteRun {
  readonly startedAt: number
  readonly finishedAt?: number
  readonly ok?: boolean
  readonly summary?: string
  readonly by?: 'user' | 'schedule'
}

export interface NoteModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** 便签的任务泳道身份：存在即任务，普通便签无此字段。 */
export interface NoteLane {
  readonly status: TaskStatus
  readonly run?: NoteRun
  /** 缺省 = 宿主默认预设。 */
  readonly agentPreset?: string
  /** 缺省 = 宿主默认模型。 */
  readonly model?: NoteModelSelection
}

export interface TaskModelOption {
  readonly id: string
  readonly name: string
}

export interface TaskModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly TaskModelOption[]
}

export interface TaskPresetOption {
  readonly id: string
  readonly name: string
}

/** notes/taskTargets 的返回值；宿主没装会话控制器或预设服务时为空目录。 */
export interface TaskTargets {
  readonly models: readonly TaskModelGroup[]
  readonly presets: readonly TaskPresetOption[]
}

export const SCHEDULE_MODES = ['once', 'interval', 'daily', 'weekly', 'monthly'] as const
export type ScheduleMode = (typeof SCHEDULE_MODES)[number]

/**
 * 定时日程：到点由 host 调度器派发一次。once 触发成功后自动停用；
 * interval 的锚点是上次排定的 nextAt；monthly 的 monthDay 当月不足时落在最后一天。
 */
export interface NoteSchedule {
  readonly enabled: boolean
  readonly mode: ScheduleMode
  /** once：触发时刻（绝对 ms）。 */
  readonly at?: number
  /** interval：间隔分钟（>= 1）。 */
  readonly everyMin?: number
  /** daily/weekly/monthly：当日触发时刻，'HH:mm'。 */
  readonly time?: string
  /**
   * weekly：星期几（0=周日 … 6=周六，非空）。
   * 刻意用可变数组：dsh-tools 的 DSL 把数组推断成 `T[]`，readonly 会让
   * agent 工具的输出类型对不上；只读语义由 sanitizeSchedule 保证。
   */
  weekdays?: number[]
  /** monthly：每月第几日（1-31）。 */
  readonly monthDay?: number
  /** 下次触发时刻，host 计算写回，UI 只读。 */
  readonly nextAt: number
  readonly lastFiredAt?: number
  /** 最近一次派发/跳过的说明（中文短句）。 */
  readonly lastResult?: string
  /**
   * 连续失败计数：派发或运行失败都算，派发成功清零，
   * 被状态闸门挡住不算。达到 SCHEDULE_MAX_FAILURES 自动停用。
   */
  readonly failureStreak?: number
  /** 累计成功派发次数，不设上限。 */
  readonly runCount?: number
}

/**
 * client → host 的可写日程；保存时 host 按 now 重算 nextAt 并保留派发信息，
 * failureStreak / runCount 是 host 自有值，client 原样回传。
 */
export type NoteScheduleInput = Omit<
  NoteSchedule,
  'nextAt' | 'lastFiredAt' | 'lastResult' | 'failureStreak' | 'runCount'
> & {
  readonly nextAt?: number
  readonly lastFiredAt?: number
  readonly lastResult?: string
  readonly failureStreak?: number
  readonly runCount?: number
}

/** 便签来源；guard 拒绝 agent 删除/覆盖 user 便签，旧记录回填 'user'。 */
export const NOTE_ORIGINS = ['user', 'agent'] as const
export type NoteOrigin = (typeof NOTE_ORIGINS)[number]

/** 存储记录；text 是纯文本/markdown。 */
export interface NoteRecord {
  readonly id: NoteId
  readonly title: string
  readonly text: string
  readonly pinned: boolean
  /** 归档便签不进活动列表，折叠在列表底部。 */
  readonly archived: boolean
  /** 旧记录缺省，schema 回填默认黄。 */
  readonly color: NoteColor
  readonly origin: NoteOrigin
  readonly lane?: NoteLane
  /** 仅任务便签有效；缺省 = 不定时。 */
  readonly schedule?: NoteSchedule
  /**
   * 任务执行工作区（绝对目录路径）。任务必须有工作区：缺省时执行被拒
   * （reason='missing-workspace'）。
   */
  readonly workspace?: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface NoteCreateInput {
  readonly title?: string
  readonly text: string
  readonly color?: NoteColor
  /** 仅 host 侧直调方会传 'agent'；client 经 codec 传不进该字段。 */
  readonly origin?: NoteOrigin
  /** 给了即新建任务；缺省不落 lane。 */
  readonly laneStatus?: TaskStatus
  /** trim 后空串视同未给、不落该字段。 */
  readonly workspace?: string
  /** 仅与 laneStatus 搭配才有意义；agentPreset trim 后空串视同未给。 */
  readonly agentPreset?: string
  readonly model?: NoteModelSelection
  /** 仅与 laneStatus 搭配才有意义。 */
  readonly schedule?: NoteScheduleInput
}

/** origin 不可经 update 修改。 */
export interface NoteUpdateInput {
  readonly title?: string
  readonly text?: string
  readonly pinned?: boolean
  readonly archived?: boolean
  readonly color?: NoteColor
  /**
   * 任务泳道 patch：status/run 逐字段合并；`clear: true` = 取消任务，
   * 与 status/run 互斥，并存时 clear 优先。
   */
  readonly lane?: {
    readonly status?: TaskStatus
    readonly run?: NoteRun
    readonly clear?: true
    /** trim 后空串 = 清除（回宿主默认）；未给保留原值。 */
    readonly agentPreset?: string
    /** null = 清除（唯一清除信号）；未给保留原值；给对象整体替换。 */
    readonly model?: NoteModelSelection | null
  }
  /** trim 后空串 = 清除（此后执行被拒 missing-workspace）；未给保留原值。 */
  readonly workspace?: string
  /**
   * `null` = 清除定时；未给保留原值，给对象整体替换。
   * 取消任务或关掉任务开关时，日程一并清除。
   */
  readonly schedule?: NoteScheduleInput | null
}

export interface NotesConfig {
  readonly defaultTitle: string
  readonly webdav?: NotesWebdavConfig
  readonly openMode?: NoteOpenMode
  readonly entry?: NotesEntryConfig
}

/**
 * 每个可插入位点一个开关。list 槽关掉 = 返回 null（空 div 会留空白条）；
 * sidebar.panellist 关掉 = 注销注册（宿主自画外壳，返回 null 只剩空壳）。
 * 至少留一个开关，判据见 enabledEntryCount。
 */
export interface NotesEntryConfig {
  /** 槽位 sidebar.panellist。 */
  readonly sidebarPanelIcon: boolean
  /** 槽位 conversation.input.left：一个字形，点开是「新增便签 / 便签板 / 任务泳道」。 */
  readonly inputToolbar: boolean
  /** 槽位 conversation.chat.assistant-actions：把回答带进新建便签编辑器。 */
  readonly saveMessageAction: boolean
  /** 关闭即注销右侧栏的 notes tab 类型；导引卡是注册表的投影。 */
  readonly rightSidebarGuide: boolean
}

export const DEFAULT_NOTES_ENTRY_CONFIG: NotesEntryConfig = {
  sidebarPanelIcon: true,
  inputToolbar: true,
  saveMessageAction: true,
  rightSidebarGuide: true,
}

/** 顺序 = 设置页展示顺序。 */
export const NOTES_ENTRY_KEYS: readonly (keyof NotesEntryConfig)[] = [
  'sidebarPanelIcon',
  'inputToolbar',
  'saveMessageAction',
  'rightSidebarGuide',
]

/** 已开启的入口数；config 缺省时按 DEFAULT_NOTES_ENTRY_CONFIG 算。 */
export function enabledEntryCount(config: NotesEntryConfig | undefined): number {
  const effective = config ?? DEFAULT_NOTES_ENTRY_CONFIG
  return NOTES_ENTRY_KEYS.filter((key) => effective[key]).length
}

/**
 * 打开方式：'main' = 中间列（默认），'right' = 右侧栏 tab；
 * 只有「打开便签板」这个动作看它。
 * 宿主没装右侧栏（可选能力）时回退 'main'（见 client/index.ts 的 openBoard）。
 */
export const NOTE_OPEN_MODES = ['main', 'right'] as const
export type NoteOpenMode = (typeof NOTE_OPEN_MODES)[number]

export const DEFAULT_NOTE_OPEN_MODE: NoteOpenMode = 'main'

export function notesOpenMode(config: NotesConfig | undefined): NoteOpenMode {
  const value = config?.openMode
  return (NOTE_OPEN_MODES as readonly string[]).includes(value as string)
    ? (value as NoteOpenMode)
    : DEFAULT_NOTE_OPEN_MODE
}

export interface NotesWebdavConfig {
  readonly enabled: boolean
  /** HTTPS 根地址，结尾带斜杠，如 https://dav.jianguoyun.com/dav/ 。 */
  readonly url: string
  readonly username: string
  /** 应用密码，不是服务商主密码。 */
  readonly password: string
  /** 相对根目录，结尾带斜杠，如 dsh/notes/ 。 */
  readonly path: string
  readonly intervalMin: number
  /** 远端保留份数，超出删最旧。 */
  readonly keep: number
}

/** 与 settings.ts 的 schema base 一致。 */
export const DEFAULT_WEBDAV_CONFIG: NotesWebdavConfig = {
  enabled: false,
  url: '',
  username: '',
  password: '',
  path: 'dsh/notes/',
  intervalMin: 30,
  keep: 10,
}

export type WebdavBackupResult =
  | { readonly ok: true; readonly snapshot: string }
  | { readonly ok: false; readonly reason: string }

/** files = 本插件快照文件名，按时间戳可排序。 */
export type WebdavListResult =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/** restored = 重建便签数。 */
export type WebdavRestoreResult =
  | { readonly ok: true; readonly restored: number; readonly from: string }
  | { readonly ok: false; readonly reason: string }

/** 存在 meta 存储域，设置弹窗展示最近结果。 */
export interface WebdavStatus {
  readonly enabled: boolean
  readonly lastBackupAt: number | null
  readonly lastBackupOk: boolean | null
  readonly lastBackupError: string | null
  readonly lastBackupName: string | null
  readonly lastRestoreAt: number | null
  readonly lastRestoreOk: boolean | null
  readonly lastRestoreName: string | null
}

/**
 * 设置命名空间 = profile 条目 id，须与 cordis.patch.yml 的 id 一致。
 * 另一套 `plugin-*` 前缀只用在 client 侧槽位 id。
 */
export const NOTES_NAMESPACE = 'zzerx-notes'
