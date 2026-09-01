/**
 * plugin-notes 领域类型：品牌 id、存储记录、会话事件载荷。
 * 跨 host/client 共享；host 与 client 都从这里 type-only import。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** 便签 id：跨包边界传递的品牌字符串。 */
export type NoteId = Branded<'NoteId'>

/** 存储记录（notes domain 的 zod schema 见 domain.ts）。text 为纯文本/markdown。 */
export interface NoteRecord {
  readonly id: NoteId
  readonly title: string
  readonly text: string
  readonly pinned: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

/** 新建便签入参。 */
export interface NoteCreateInput {
  readonly title?: string
  readonly text: string
}

/** 更新便签入参（全部可选，至少一项）。 */
export interface NoteUpdateInput {
  readonly title?: string
  readonly text?: string
  readonly pinned?: boolean
}

/** 会话事件载荷：note/listed 携带完整列表快照（整值检查点，last-write-wins）。 */
export interface NoteListedData {
  readonly revision: number
  readonly notes: readonly NoteRecord[]
}

/** plugin-notes 设置（forge-studio.notes 命名空间；host schema 见 settings.ts）。 */
export interface NotesConfig {
  /** 便签板最多展示的便签数。 */
  readonly maxVisibleNotes: number
  /** 新建便签的默认标题。 */
  readonly defaultTitle: string
}

/**
 * 设置命名空间：host 注册 schema 与 client 卡片共用（client-safe 常量）。
 * 命名规则只允许小写字母/数字/连字符（无点），见 dsh-settings 的
 * SettingsNamespaceInput 约束。
 */
export const NOTES_NAMESPACE = 'forge-studio-notes'
