/**
 * plugin-notes 领域类型：品牌 id、存储记录、设置。
 * 跨 host/client 共享；host 与 client 都从这里 type-only import。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** 便签 id：跨包边界传递的品牌字符串。 */
export type NoteId = Branded<'NoteId'>

/**
 * 便签纸颜色。源色板为 Win11 便签同款六色（黄/蓝/绿/粉/紫/灰），紫色回归为
 * 自由分类色；任务状态与颜色解耦后，颜色只是卡片底色，不再表任务状态
 * （任务泳道按 note.lane.status 分列，见 client core/task-lanes.ts）。
 */
export const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'gray'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

/** 新建便签的默认纸色（Win11 同款：黄）。 */
export const DEFAULT_NOTE_COLOR: NoteColor = 'yellow'

/**
 * 颜色值归一（历史/非法输入兜底）：枚举成员（含回归的紫色）原样返回；
 * 其余非法值返回 undefined，由调用方决定回退默认色。
 */
export function normalizeNoteColor(value: unknown): NoteColor | undefined {
  return (NOTE_COLORS as readonly string[]).includes(value as string)
    ? (value as NoteColor)
    : undefined
}

/**
 * 任务状态（与 dsh-task-board 五列语义一致，稳定 id 供拖拽/回调传递）。
 * 泳道数据模型去耦后，状态不再由纸色派生，而是内嵌于便签的 lane 对象。
 */
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'done' | 'failed'

/**
 * 单次任务执行帧：开始/结束时间、成败与 AI 结果摘要（markdown，短）。
 * `by` 记录这一轮的发起方：'schedule' = 定时调度器自动派发，'user' = 用户点「执行」
 * （旧记录无该字段，视同 'user'）。host 的超时兜底只收拾 'schedule' 的 run——
 * 用户手点、人就在旁边看着的长跑不该被 host 强行收尾。
 */
export interface NoteRun {
  readonly startedAt: number
  readonly finishedAt?: number
  readonly ok?: boolean
  readonly summary?: string
  readonly by?: 'user' | 'schedule'
}

/**
 * 任务执行时用的模型选择（provider/model 必填，reasoningEffort 可选）。
 * 只在本插件内表达「这张任务便签跑哪个模型」，跨包边界时按普通对象透传。
 */
export interface NoteModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/**
 * 便签的任务泳道身份（D1/D3：显式标记，存在即任务）。普通便签无此字段
 * （缺省 undefined），不进泳道。结果 run 不污染正文。
 *
 * agentPreset / model 是**可选执行目标**（M2）：都缺省即「用宿主默认」，执行时
 * 新建会话照旧不带预设、也不额外选模型。旧记录天然无这两个字段，解析不炸。
 */
export interface NoteLane {
  readonly status: TaskStatus
  readonly run?: NoteRun
  /** 执行会话的 agent 预设 id；缺省 undefined = 宿主默认预设。 */
  readonly agentPreset?: string
  /** 执行会话的模型；缺省 undefined = 宿主默认模型。 */
  readonly model?: NoteModelSelection
}

/* ---------- 任务执行目标目录（host 投影 → 编辑器下拉） ---------- */

/** 一个可选模型（宿主模型目录的精简投影，只留下拉要用的字段）。 */
export interface TaskModelOption {
  readonly id: string
  readonly name: string
}

/** 一个 provider 及其可选模型（下拉里按 provider 分组）。 */
export interface TaskModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly TaskModelOption[]
}

/** 一个可选 agent 预设。 */
export interface TaskPresetOption {
  readonly id: string
  readonly name: string
}

/**
 * 任务执行目标目录（notes/taskTargets 端点返回值）：编辑器那两个下拉（模型 / 预设）
 * 的数据源。宿主没装配会话控制器 / 预设服务时一律空目录，编辑器据此只显示「宿主默认」。
 */
export interface TaskTargets {
  readonly models: readonly TaskModelGroup[]
  readonly presets: readonly TaskPresetOption[]
}

/** 定时日程的循环形态：一次性 / 固定间隔 / 每天 / 每周 / 每月。 */
export const SCHEDULE_MODES = ['once', 'interval', 'daily', 'weekly', 'monthly'] as const
export type ScheduleMode = (typeof SCHEDULE_MODES)[number]

/**
 * 任务定时执行日程（便签级，仅任务便签有意义）：到点由 host 调度器自动派发一次，
 * 等价于用户点「执行」（同样新建会话 + 投递 + 租约）。
 * - `once`：`at` 指定绝对时刻，触发成功后自动停用（记录保留，UI 显示「已执行」）；
 * - `interval`：每 `everyMin` 分钟一次（锚点 = 上次排定的 nextAt，节奏不随 tick 漂移）；
 * - `daily`：每天 `time`；`weekly`：每周 `weekdays`（0=周日…6=周六）的 `time`；
 *   `monthly`：每月 `monthDay`（1-31；当月不足时落在当月最后一天）的 `time`。
 * `nextAt` 是**权威**的下次触发时刻，由 host 计算并写回；`lastFiredAt`/`lastResult`
 * 记录最近一次派发结果（含跳过原因），仅供 UI 展示。
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
   *
   * 刻意用可变数组（非 readonly）：agent 工具的输出 schema 走 dsh-tools 的 DSL，
   * 其数组一律推断为可变 `T[]`，readonly 数组会让工具输出类型对不上（见
   * agent/tools.ts 的 SCHEDULE_SCHEMA）。只读语义由 sanitizeSchedule 归一保证。
   */
  weekdays?: number[]
  /** monthly：每月第几日（1-31）。 */
  readonly monthDay?: number
  /** 下次触发时刻（host 计算写回；UI 只读展示）。 */
  readonly nextAt: number
  /** 最近一次真正派发的时刻。 */
  readonly lastFiredAt?: number
  /** 最近一次派发/跳过的结果说明（中文短句，UI 展示）。 */
  readonly lastResult?: string
  /**
   * 错误边界：连续失败计数（派发失败或运行失败都算；派发成功清零，被状态闸门挡住不算）。
   * 达到 SCHEDULE_MAX_FAILURES 自动停用，防止无人值守时无限重试。
   */
  readonly failureStreak?: number
  /** 累计成功派发次数（只记数，不设上限；UI 展示「已跑 N 次」）。 */
  readonly runCount?: number
}

/**
 * 可写的日程入参（client → host）：结构同 NoteSchedule，但 host 自有字段（nextAt /
 * lastFiredAt / lastResult）可选——保存时 host 一律按「保存时刻之后」重算 nextAt，
 * 并保留宿主已记录的最近派发信息。
 */
export type NoteScheduleInput = Omit<
  NoteSchedule,
  'nextAt' | 'lastFiredAt' | 'lastResult' | 'failureStreak' | 'runCount'
> & {
  readonly nextAt?: number
  readonly lastFiredAt?: number
  readonly lastResult?: string
  /** host 自有：连续失败计数（client 只读带出，原样回传）。 */
  readonly failureStreak?: number
  /** host 自有：累计成功派发次数（client 只读带出，原样回传）。 */
  readonly runCount?: number
}

/**
 * 便签来源：'user' = 用户手写（client UI / 默认），'agent' = agent 工具创建。
 * 权限边界依据：guard 拒绝 agent 删除/覆盖 user 便签；agent 只能自由管理
 * 自己 origin='agent' 的便签。旧记录 schema 缺省回填 'user'。
 */
export const NOTE_ORIGINS = ['user', 'agent'] as const
export type NoteOrigin = (typeof NOTE_ORIGINS)[number]

/** 存储记录（notes domain 的 zod schema 见 domain.ts）。text 为纯文本/markdown。 */
export interface NoteRecord {
  readonly id: NoteId
  readonly title: string
  readonly text: string
  readonly pinned: boolean
  /** 归档标记：归档便签不进活动列表，折叠在列表底部（schema 缺省回填 false）。 */
  readonly archived: boolean
  /** 便签纸颜色；旧记录缺省（打开时 schema 回填默认黄）。 */
  readonly color: NoteColor
  /** 便签来源（user 手写 / agent 创建）；schema 缺省回填 'user'。 */
  readonly origin: NoteOrigin
  /** 任务泳道身份（可选）：存在即任务；缺省 undefined = 普通便签。 */
  readonly lane?: NoteLane
  /**
   * 定时执行日程（可选，仅任务便签有效）：host 调度器到点自动派发。缺省 undefined =
   * 不定时；与 lane/workspace 同款可选字段，旧记录无、解析不炸、无需版本迁移。
   */
  readonly schedule?: NoteSchedule
  /**
   * 任务执行工作区（绝对目录路径）：执行时以该目录**新建会话**跑任务。
   * **任务必须有工作区**（M1-4：不再有「默认工作区」兜底）——缺省 undefined 时
   * 执行直接拒绝（reason='missing-workspace'），编辑器也不允许把便签设成任务。
   */
  readonly workspace?: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** 新建便签入参。 */
export interface NoteCreateInput {
  readonly title?: string
  readonly text: string
  readonly color?: NoteColor
  /**
   * 来源标记，仅 host 侧服务直调方（agent 工具层）会显式传 'agent'；
   * client UI 不透传（codec 丢弃该字段），host 默认落 'user'。
   */
  readonly origin?: NoteOrigin
  /** 新建即任务：初始泳道状态（列头「＋新建任务」用，缺省不落 lane）。 */
  readonly laneStatus?: TaskStatus
  /** 任务执行工作区：trim 后为空串视同未给，不落该字段（任务必须有工作区）。 */
  readonly workspace?: string
  /**
   * 执行目标（可选）：仅与 laneStatus（新建即任务）搭配才有意义，缺省不落该字段。
   * agentPreset trim 后为空视同未给；model 缺省 = 宿主默认模型。
   */
  readonly agentPreset?: string
  readonly model?: NoteModelSelection
  /** 定时日程（可选）：仅与 laneStatus（新建即任务）搭配才有意义，缺省不落该字段。 */
  readonly schedule?: NoteScheduleInput
}

/** 更新便签入参（全部可选，至少一项）。origin 不可经 update 修改。 */
export interface NoteUpdateInput {
  readonly title?: string
  readonly text?: string
  readonly pinned?: boolean
  /** 归档/取消归档。 */
  readonly archived?: boolean
  readonly color?: NoteColor
  /**
   * 任务泳道 patch（partial）：status/run 均可选，逐字段合并；`clear: true`
   * 为「取消任务」——删除 lane 身份（next.lane = undefined），与 status/run
   * 互斥，并存时 clear 优先（status/run 被忽略）。
   */
  readonly lane?: {
    readonly status?: TaskStatus
    readonly run?: NoteRun
    readonly clear?: true
    /**
     * 执行目标：给值即覆盖；trim 后空串 = **清除**（回到宿主默认预设）；未给保留原值。
     * 与 workspace 同一套「空串即清除」语义（wire 上 undefined 会被丢弃）。
     */
    readonly agentPreset?: string
    /**
     * 执行模型：给 null = **清除**（回到宿主默认模型，唯一清除信号）；未给保留原值；
     * 给对象即整体替换。
     */
    readonly model?: NoteModelSelection | null
  }
  /**
   * 任务执行工作区：给值即覆盖（trim 后空串 = **清除**该字段，此后该任务执行会被
   * 拒为 missing-workspace）；未给（undefined）保留原值。空串是唯一清除信号
   * （wire 上 undefined 会被丢弃）。
   */
  readonly workspace?: string
  /**
   * 定时日程：`null` = **清除**（取消定时，唯一清除信号，wire 上 undefined 会被丢弃）；
   * 未给保留原值；给对象即整体替换，host 保存时按 now 重算 nextAt。取消任务
   * （lane.clear）与关闭任务开关时，日程一并清除（无 lane 则日程无意义）。
   */
  readonly schedule?: NoteScheduleInput | null
}

/** plugin-notes 设置（命名空间 = profile 条目 id `zzerx-notes`；host schema 见 settings.ts）。 */
export interface NotesConfig {
  /** 新建便签的默认标题。 */
  readonly defaultTitle: string
  /** WebDAV 备份配置（缺省 = 关闭，见 DEFAULT_WEBDAV_CONFIG）。 */
  readonly webdav?: NotesWebdavConfig
  /**
   * 便签板的打开方式（缺省 = 中间列，见 NOTE_OPEN_MODES）。
   * 只管「打开便签板」这个动作，不管右侧栏导引页那张卡片。
   */
  readonly openMode?: NoteOpenMode
  /**
   * UI 入口开关（缺省见 DEFAULT_NOTES_ENTRY_CONFIG）。
   * 关掉即整个入口消失（list 槽返回 null / panellist 注销注册，见 NotesEntryConfig）。
   */
  readonly entry?: NotesEntryConfig
}

/**
 * UI 入口开关：每个可插入位点一个布尔，用户在便签板设置里逐项开关。
 *
 * **两种关法，按宿主怎么画这个位点选**：
 * - **list 槽**（输入栏工具条、助手消息动作）：关掉 = 组件返回 null。这些位点带
 *   `:empty { display: none }`，渲染空 div 会留下空白条，所以必须真返回 null；
 *   注册本身不用动。
 * - **宿主自画外壳的位点**（`sidebar.panellist`）：关掉 = **注销注册**。宿主会给每个
 *   panellist 项画自己的按钮外壳（`label` 也在壳里），让组件返回 null 只会剩下一条
 *   写着「便签」的空壳 —— 所以这里走 `scope.subscribe` + 注销 / 重注册（写法见
 *   client/index.ts 的 syncPanelEntry，与右侧栏 tab 类型同一套）。
 *
 * **至少留一个**：全部关掉之后便签板自己就一个打开的地方都没有了（设置页在
 * dsh 设置里，不受入口开关影响，所以进得去设置、改得回来，但板子开不出来）。
 * 设置页据此禁掉最后一个开关，判据见 enabledEntryCount。
 */
export interface NotesEntryConfig {
  /**
   * **侧栏顶部**那一行（sidebar.panellist）—— 便签板本体的入口。渲染成
   * [图标 便签 ......... 待办数 (＋)] 的**整行**：标题与两个控件都在插件字形里，
   * 靠 CSS 接管宿主那一行（判定与回退见 styles/notes-entry.module.css）。
   */
  readonly sidebarPanelIcon: boolean
  /**
   * 输入栏左侧的便签入口（conversation.input.left）：**一个**字形，点开是「新增便签
   * / 便签板 / 任务泳道」三行菜单。三件事仍是**一个**槽位注册（含三行），所以开关也
   * 只有这一个 —— 合并入口就是为了别再让同一件事在输入框左右各站一个按钮。
   */
  readonly inputToolbar: boolean
  /**
   * 助手消息下方「存成便签」动作（conversation.chat.assistant-actions）：把这条回答
   * 带进新建便签编辑器（预填标题与正文），由用户确认后保存。
   */
  readonly saveMessageAction: boolean
  /**
   * 右侧栏导引卡片 + 便签 tab：在 dsh 的 tab 类型注册表里注册一个 notes 类型，
   * 它带一张导引卡（导引页点一下就在右侧栏以 tab 形式打开便签板），本体复用
   * 便签板组件。关掉即把该类型整个注销 —— 导引卡是注册表的投影，没有别的关法。
   */
  readonly rightSidebarGuide: boolean
}

/** 入口开关缺省值：核心入口开、扩展入口关（与 settings.ts 的 schema base 一致）。 */
export const DEFAULT_NOTES_ENTRY_CONFIG: NotesEntryConfig = {
  sidebarPanelIcon: true,
  inputToolbar: true,
  saveMessageAction: true,
  rightSidebarGuide: true,
}

/** 全部入口开关的键（顺序 = 设置页里的展示顺序）。 */
export const NOTES_ENTRY_KEYS: readonly (keyof NotesEntryConfig)[] = [
  'sidebarPanelIcon',
  'inputToolbar',
  'saveMessageAction',
  'rightSidebarGuide',
]

/**
 * 数一数开了几个入口。设置页用它守住「至少留一个」—— 全关掉之后便签就没有任何
 * 入口了，连设置页本身都打不开。
 * @param config - 入口开关配置（快照可能为空，按缺省表算）。
 * @returns 已开启的入口数量。
 */
export function enabledEntryCount(config: NotesEntryConfig | undefined): number {
  const effective = config ?? DEFAULT_NOTES_ENTRY_CONFIG
  return NOTES_ENTRY_KEYS.filter((key) => effective[key]).length
}

/**
 * 便签板的打开方式：
 * - 'main'：中间列的面板（默认，也就是插件一直以来的行为）；
 * - 'right'：右侧栏里的便签 tab —— 与导引卡片点进去的是同一个 tab，打开时右侧栏自动展开。
 *
 * 只有「打开便签板」这个动作看它：左栏顶部那一行、输入栏工具条的「打开便签板」。
 * 右侧栏导引页那张卡片照旧 —— 它本身就是右侧栏的入口，不受这里影响。
 * 宿主没装右侧栏（可选能力）时一律回退 'main'，见 client/index.ts 的 openBoard。
 */
export const NOTE_OPEN_MODES = ['main', 'right'] as const
export type NoteOpenMode = (typeof NOTE_OPEN_MODES)[number]

/** 打开方式缺省值：中间列（与历史行为一致）。 */
export const DEFAULT_NOTE_OPEN_MODE: NoteOpenMode = 'main'

/**
 * 把配置里的打开方式归一成合法值：旧配置没这个字段、或者被手改坏了，都回退缺省。
 * @param config - 便签配置快照（可能还没有值）。
 * @returns 合法的打开方式。
 */
export function notesOpenMode(config: NotesConfig | undefined): NoteOpenMode {
  const value = config?.openMode
  return (NOTE_OPEN_MODES as readonly string[]).includes(value as string)
    ? (value as NoteOpenMode)
    : DEFAULT_NOTE_OPEN_MODE
}

/** WebDAV 备份配置（与应用密码一起存本地 settings；不做云上云）。 */
export interface NotesWebdavConfig {
  /** 总开关。 */
  readonly enabled: boolean
  /** WebDAV 根地址（HTTPS，结尾斜杠），如 https://dav.jianguoyun.com/dav/ 。 */
  readonly url: string
  /** 账号（坚果云等为用户名/邮箱）。 */
  readonly username: string
  /** 应用密码（服务商主密码勿填此处）。 */
  readonly password: string
  /** 远端目录（相对根，结尾斜杠），如 dsh/notes/ 。 */
  readonly path: string
  /** 定时检查间隔（分钟）。 */
  readonly intervalMin: number
  /** 远端保留的快照份数（超出删最旧）。 */
  readonly keep: number
}

/** WebDAV 配置缺省值（与 settings.ts schema base 保持一致）。 */
export const DEFAULT_WEBDAV_CONFIG: NotesWebdavConfig = {
  enabled: false,
  url: '',
  username: '',
  password: '',
  path: 'dsh/notes/',
  intervalMin: 30,
  keep: 10,
}

/** 备份执行结果（client 直读；host 引擎产出）。 */
export type WebdavBackupResult =
  | { readonly ok: true; readonly snapshot: string }
  | { readonly ok: false; readonly reason: string }

/** 远端快照列表结果（files = 本插件快照文件名，时间戳可排序）。 */
export type WebdavListResult =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/** 恢复执行结果（restored = 重建便签数）。 */
export type WebdavRestoreResult =
  | { readonly ok: true; readonly restored: number; readonly from: string }
  | { readonly ok: false; readonly reason: string }

/** WebDAV 备份引擎状态（设置弹窗展示最近结果；来源 = meta 存储域）。 */
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
 * 设置命名空间：dsh 0.1.7 起 = 本插件在 profile 里的**条目 id**（bundle patch 的
 * `id: zzerx-notes`，见 cordis.patch.yml），不再是自取的字符串命名空间。
 * host（loader 装配的 Config）与 client 卡片共用这个常量（client-safe）。
 * `plugin-*` 与 `forge-studio-*` 前缀只保留在 client 侧槽位 id 上（那是另一套命名空间）。
 */
export const NOTES_NAMESPACE = 'zzerx-notes'