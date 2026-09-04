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

/** 单次任务执行帧：开始/结束时间、成败与 AI 结果摘要（markdown，短）。 */
export interface NoteRun {
  readonly startedAt: number
  readonly finishedAt?: number
  readonly ok?: boolean
  readonly summary?: string
}

/**
 * 便签的任务泳道身份（D1/D3：显式标记，存在即任务）。普通便签无此字段
 * （缺省 undefined），不进泳道。结果 run 不污染正文。
 */
export interface NoteLane {
  readonly status: TaskStatus
  readonly run?: NoteRun
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
  }
}

/**
 * @便签 mention URI scheme（插件私有，不改 harness 引用通道）：
 * `@[标题](note://<uuid>)`。agent 收到该文本后经 notes_get 读取全文。
 * 标题内若含 ']' 会破坏语法 —— formatNoteMention 负责转义。
 */
export const NOTE_MENTION_SCHEME = 'note'

/** 把一张便签格式化为会话 mention 文本（client 引用按钮与 host 共用）。 */
export function formatNoteMention(id: NoteId, title: string): string {
  const label = title.replace(/\]/gu, '\\]').replace(/\(/gu, '\\(')
  return `@[${label || '便签'}](note://${id})`
}

/** plugin-notes 设置（forge-studio-notes 命名空间；host schema 见 settings.ts）。 */
export interface NotesConfig {
  /** 新建便签的默认标题。 */
  readonly defaultTitle: string
}

/**
 * 设置命名空间：host 注册 schema 与 client 卡片共用（client-safe 常量）。
 * 命名规则只允许小写字母/数字/连字符（无点），见 dsh-settings 的
 * SettingsNamespaceInput 约束。
 */
export const NOTES_NAMESPACE = 'forge-studio-notes'
