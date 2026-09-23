/**
 * plugin-daily-log 领域类型：品牌 id、存储记录、设置、扫描活动条目。
 * 跨 host/client 共享；host 与 client 都从这里 type-only import。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** 数据源 id。 */
export type SourceId = Branded<'SourceId'>
/** 报告 id。 */
export type ReportId = Branded<'ReportId'>
/** 报告模板 id。 */
export type TemplateId = Branded<'TemplateId'>

/** 渠道（来源工具）：一个项目路径下可聚合的活动来源。 */
export const SOURCE_KINDS = ['git', 'claude', 'codex', 'dsh'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** 渠道显示名（UI 来源徽标）。 */
export const CHANNEL_LABELS: Record<SourceKind, string> = {
  git: 'Git',
  claude: 'Claude',
  codex: 'Codex',
  dsh: 'DSH',
}

/**
 * 项目类型：代码项目（含 .git 的仓库，扫 git 提交）vs 其他（会话/文档目录）。
 * 自动判定：目录下存在 .git（目录或文件）→ 'code'，否则 'other'。
 */
export const SOURCE_TYPES = ['code', 'other'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

/** 项目类型显示名（UI 徽标）。 */
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  code: '代码项目',
  other: '其他',
}

/**
 * 项目记录（数据源 = 一个项目/工作区路径，渠道在扫描时对 path 自动探测聚合）。
 */
export interface SourceRecord {
  readonly id: SourceId
  /** 项目类型（代码项目 / 其他），添加时自动判定或显式传入。 */
  readonly type: SourceType
  /** 显示名（项目目录名 / 自定义名）。 */
  readonly label: string
  /** 绝对路径（项目/工作区目录；同路径唯一）。 */
  readonly path: string
  /** 可选：git 提交按作者过滤（author email）。 */
  readonly author?: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** 新建项目入参。 */
export interface SourceAddInput {
  readonly label?: string
  readonly path: string
  readonly author?: string
  /** 项目类型；缺省由 host 探测（目录含 .git → code，否则 other）。 */
  readonly type?: SourceType
}

/** 某项目路径下命中的渠道集合（git 提交 / dsh 会话 / claude / codex）。 */
export interface ProjectChannels {
  git: boolean
  dsh: boolean
  claude: boolean
  codex: boolean
}

/** 一个渠道都没有命中的空标记（纯项目记录）。 */
export const NO_CHANNELS: ProjectChannels = { git: false, dsh: false, claude: false, codex: false }

/**
 * 可发现的项目候选（DSH 工作区项目 / 手动路径探测结果）。
 * 由 host 发现（listWorkspaceCandidates），client 只读展示并一键添加。
 */
export interface ProjectCandidate {
  readonly path: string
  /** 显示标题（项目目录名）。 */
  readonly title: string
  readonly type: SourceType
  /** 该路径下命中的渠道（dsh=已在工作区；git/claude/codex 现场探测）。 */
  readonly channels: ProjectChannels
  /** 附加说明（如「N 个关联会话」）。 */
  readonly detail?: string
  /** 是否已在数据源中（host 已做路径归一化对比）。 */
  readonly added: boolean
}

/** 时间范围（since/until 均取 git 可解析的日期串，如 '2026-06-30' 或 'Monday'）。 */
export interface DateRange {
  readonly since: string
  readonly until?: string
}

/** 报告记录。 */
export interface ReportRecord {
  readonly id: ReportId
  readonly title: string
  readonly markdown: string
  readonly sourceIds: SourceId[]
  readonly templateId?: TemplateId
  readonly reportType?: string
  readonly dateRange: DateRange
  readonly createdAt: number
}

/** 新建报告入参。 */
export interface ReportCreateInput {
  readonly title: string
  readonly markdown: string
  readonly sourceIds: SourceId[]
  readonly templateId?: TemplateId
  readonly reportType?: string
  readonly dateRange: DateRange
}

/** 报告模板记录。 */
export interface TemplateRecord {
  readonly id: TemplateId
  readonly name: string
  /** 指令段（可选）+ <!-- DATA --> + 骨架段（LLM 引导格式）。 */
  readonly content: string
  readonly isBuiltin: boolean
  readonly isDefault: boolean
  readonly updatedAt: number
}

/** 内置默认模板名（只读，不可更新/删除）。 */
export const BUILTIN_TEMPLATE = 'default'

/** 扫描产出的活动条目（跨源统一形状）。 */
export interface ActivityEntry {
  readonly ts: number
  readonly sourceLabel: string
  /** 产出渠道（由 service 扫描时统一填充，渠道自身不必重复设置）。 */
  readonly channel?: SourceKind
  readonly kind: 'commit' | 'conversation'
  readonly title: string
  readonly body: string
  /** 分组键：会话渠道 = 会话 id，git = 分支名；缺省时按 title 各自成组。 */
  readonly group?: string
  /** 分组显示名（会话标题 / 分支名）。 */
  readonly groupTitle?: string
  /** 会话内角色（仅 kind=conversation）。 */
  readonly role?: 'user' | 'assistant'
}

/** 扫描结果。 */
export interface ScanResult {
  readonly sourceId: SourceId
  readonly entries: ActivityEntry[]
  readonly truncated: boolean
  readonly truncatedHint?: string
}

/** plugin-daily-log 设置（dsh 0.1.7 起命名空间 = profile 条目 id `zzerx-daily-log`）。 */
export interface DailyLogConfig {
  /** 报告署名作者名。 */
  readonly authorName: string
  /** git 提交过滤用作者邮箱；留空时默认取各仓库 `git config user.email`（仅本人提交）。 */
  readonly authorEmail: string
  /** 报告导出目录。 */
  readonly outputDir: string
  /** 安全模式：仅允许 git 只读子命令白名单。 */
  readonly safeMode: boolean
  /** 是否注册 /report 斜杠指令（关闭后模型仍可经 daily_log 派发器自行启用）。 */
  readonly enableReportCommand: boolean
}

/**
 * 设置命名空间：dsh 0.1.7 起 = 本插件在 profile 里的条目 id（cordis.patch.yml 的
 * `id: zzerx-daily-log`），不再是自取的字符串命名空间。host 与 client 卡片共用
 * （client-safe 常量）。
 */
export const DAILY_LOG_NAMESPACE = 'zzerx-daily-log'

/** 生成准备入参（只解析模板引导，不扫描）。 */
export interface ReportPrepareInput {
  readonly reportType: string
  readonly dateRange: DateRange
  readonly sourceIds?: SourceId[]
  readonly templateId?: TemplateId
}

/** 生成准备结果。 */
export interface ReportPrepareResult {
  readonly reportType: string
  readonly dateRange: DateRange
  readonly sourceIds: SourceId[]
  readonly sourceCount: number
  readonly template: { readonly name: string; readonly promptSection?: string; readonly skeletonSection: string }
}

/** LLM 撰写正文后保存入参。 */
export interface ReportSaveInput {
  readonly title?: string
  readonly markdown: string
  readonly sourceIds: SourceId[]
  readonly dateRange: DateRange
  readonly templateId?: TemplateId
  readonly reportType?: string
}
