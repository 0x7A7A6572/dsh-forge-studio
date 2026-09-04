/**
 * plugin-notes × agent harness 桥（host 侧）—— 便签引用（mention）的模型引导。
 *
 * 引用化（设计第 6 点）：会话文本里出现 `@[标题](note://<uuid>)` 时，agent 应当
 * 用 notes_get 读取该便签全文再作答。本模块不改 harness 引用通道 —— note:// 是
 * 插件私有的标记语法，只在系统提示里告诉 agent 含义与读取路径。
 *
 * systemPrompt 判存后挂载：无 systemPrompt 服务的宿主跳过（不影响独立 UI）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { NOTES_TOOL_PREFIX } from './tools.ts'

/** 本插件系统提示分区名（唯一，避免与宿主重复注册冲突）。 */
export const NOTES_REFERENCE_SECTION = 'forge-notes:reference'

/** 系统提示分区顺序：置于工具说明区之后（参考 SECTION_ORDERS 的 TOOL_* 带）。 */
export const NOTES_REFERENCE_ORDER = 2950

/** 分区文本：mention 语法 → notes_get 读取路径。 */
export const NOTES_REFERENCE_TEXT = [
  '## Sticky notes (plugin-notes)',
  '',
  'The user\'s desktop notes are exposed through the notes_* tools. A conversation can mention a note like',
  '`@[标题](note://<note-id>)` (or `@[label](note://<id>)` for any label). When you see a `note://` reference,',
  `call \`${NOTES_TOOL_PREFIX}get\` with that note_id to read the note's full content before answering.`,
  '',
  'Notes carry an origin: notes created through the notes_create tool are origin=agent; notes the user wrote',
  'are origin=user. You may freely read and update any note, but you can never delete a user-written note —',
  'such deletions are rejected by policy.',
].join('\n')

/**
 * 注册便签引用的系统提示分区（systemPrompt 判存后由宿主调用）。
 * @param ctx - 已挂载 ctx.notes 的宿主 ctx。
 */
export function installNotesReferencePrompt(ctx: Context): void {
  ctx.systemPrompt.section({
    name: NOTES_REFERENCE_SECTION,
    order: NOTES_REFERENCE_ORDER,
    text: NOTES_REFERENCE_TEXT,
  })
}
