/**
 * 跨 host/client 共享的领域类型（均 type-only import）。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

export type SourceId = Branded<'SourceId'>
export type ReportId = Branded<'ReportId'>
export type TemplateId = Branded<'TemplateId'>

export const SOURCE_KINDS = ['git', 'claude', 'codex', 'dsh'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const CHANNEL_LABELS: Record<SourceKind, string> = {
  git: 'Git',
  claude: 'Claude',
  codex: 'Codex',
  dsh: 'DSH',
}

/** 目录下存在 .git（目录或文件）判为 code，否则 other。 */
export const SOURCE_TYPES = ['code', 'other'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  code: '代码项目',
  other: '其他',
}

export interface SourceRecord {
  readonly id: SourceId
  readonly type: SourceType
  readonly label: string
  /** 绝对路径；同路径唯一。 */
  readonly path: string
  /** git 提交按作者邮箱过滤。 */
  readonly author?: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SourceAddInput {
  readonly label?: string
  readonly path: string
  readonly author?: string
  readonly type?: SourceType
}

export interface ProjectChannels {
  git: boolean
  dsh: boolean
  claude: boolean
  codex: boolean
}

export const NO_CHANNELS: ProjectChannels = { git: false, dsh: false, claude: false, codex: false }

export interface ProjectCandidate {
  readonly path: string
  readonly title: string
  readonly type: SourceType
  /** dsh = 已在工作区；其余现场探测。 */
  readonly channels: ProjectChannels
  readonly detail?: string
  readonly added: boolean
}

/** since/until 取 git 可解析的日期串（如 '2026-06-30'）。 */
export interface DateRange {
  readonly since: string
  readonly until?: string
}

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

export interface ReportCreateInput {
  readonly title: string
  readonly markdown: string
  readonly sourceIds: SourceId[]
  readonly templateId?: TemplateId
  readonly reportType?: string
  readonly dateRange: DateRange
}

export interface TemplateRecord {
  readonly id: TemplateId
  readonly name: string
  /** 指令段（可选）+ <!-- DATA --> + 骨架段。 */
  readonly content: string
  readonly isBuiltin: boolean
  readonly isDefault: boolean
  readonly updatedAt: number
}

/** 内置模板名，不可更新 / 删除。 */
export const BUILTIN_TEMPLATE = 'default'

export interface ActivityEntry {
  readonly ts: number
  readonly sourceLabel: string
  /** 由 service 扫描时统一填充。 */
  readonly channel?: SourceKind
  readonly kind: 'commit' | 'conversation'
  readonly title: string
  readonly body: string
  /** 会话渠道 = 会话 id，git = 分支名；缺省按 title 分组。 */
  readonly group?: string
  readonly groupTitle?: string
  /** 仅 kind=conversation 时有值。 */
  readonly role?: 'user' | 'assistant'
}

export interface ScanResult {
  readonly sourceId: SourceId
  readonly entries: ActivityEntry[]
  readonly truncated: boolean
  readonly truncatedHint?: string
}

export interface DailyLogConfig {
  readonly authorName: string
  /** 留空时回落各仓库 `git config user.email`。 */
  readonly authorEmail: string
  readonly outputDir: string
  /** 仅放行 git 只读子命令。 */
  readonly safeMode: boolean
  /** 关闭后模型仍可经 daily_log 派发器启用。 */
  readonly enableReportCommand: boolean
}

/** 必须与 cordis.patch.yml 的条目 id 一致。 */
export const DAILY_LOG_NAMESPACE = 'zzerx-daily-log'

export interface ReportPrepareInput {
  readonly reportType: string
  readonly dateRange: DateRange
  readonly sourceIds?: SourceId[]
  readonly templateId?: TemplateId
}

export interface ReportPrepareResult {
  readonly reportType: string
  readonly dateRange: DateRange
  readonly sourceIds: SourceId[]
  readonly sourceCount: number
  readonly template: { readonly name: string; readonly promptSection?: string; readonly skeletonSection: string }
}

export interface ReportSaveInput {
  readonly title?: string
  readonly markdown: string
  readonly sourceIds: SourceId[]
  readonly dateRange: DateRange
  readonly templateId?: TemplateId
  readonly reportType?: string
}
