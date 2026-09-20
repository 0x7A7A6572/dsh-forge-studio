/**
 * 记忆分区的类型面：分区 props、页签，以及三个表单草稿的形状。
 *
 * 纯类型，无运行时导出 —— 视图 / hook / 表单组件都可以只依赖它。
 * 领域模型本身（MemoryRecord 等）在 src/types.ts；这里只放「本页面自己发明的形状」。
 */

import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryRemote } from './remote.ts'
import type { MemoryEdgeRelation, MemoryEntityKind, MemoryKind, MemoryNodeKind, MemoryScope } from '../../types.ts'

/** 注册侧注入的业务面（见 src/client/index.ts）。 */
export interface SettingsSectionInjected {
  memory: MemoryRemote
}

/** 分区组件完整 props：设置外壳 owner props + 插件注入面。 */
export type SettingsSectionProps =
  PropsRuntime<'settings.section'> & InjectFace<SettingsSectionInjected>

/** 页签：两个记忆作用域 + wiki 图层的实体目录。 */
export type MemoryTab = MemoryScope | 'entity'

/** 反馈的口气：错误（带警告图标）/ 通知。 */
export type FeedbackTone = 'error' | 'notice'

/**
 * 分区里唯一一条瞬时反馈。
 * seq 是重放键：同一句话再说一次也要重新冒出来（连点两次「保存」）。
 */
export interface Feedback {
  seq: number
  text: string
  tone: FeedbackTone
}

/** 编辑中的草稿（id 为 null 表示新增）。 */
export interface Draft {
  id: string | null
  title: string
  /** 一行摘要（列表卡与关联视图用）。 */
  summary: string
  /** 别名原文；保存时按 parseAliases 拆成数组。 */
  aliases: string
  content: string
  kind: MemoryKind
  importance: number
  scope: MemoryScope
  projectPath: string
}

/** 实体草稿（id 为 null 表示新建）。 */
export interface EntityDraft {
  id: string | null
  name: string
  kind: MemoryEntityKind
  aliases: string
  summary: string
}

/** 详情弹窗里「连一条边」的表单。 */
export interface LinkDraft {
  toKind: MemoryNodeKind
  toId: string
  relation: MemoryEdgeRelation
  note: string
}
