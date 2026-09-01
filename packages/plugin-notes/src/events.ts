/**
 * 会话事件族：note/listed —— 每次便签变更后由工具或命令写入完整列表快照。
 * “模型可见即已记录”：工具写入事件，UI 节点从事件流折叠渲染。
 * 整值检查点（last-write-wins）保证事件窗口从任意位置开始都能重建便签板。
 */

import type { NoteListedData } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * 一次便签变更后的完整便签列表快照。
     * `revision`：会话内单调递增（从日志已有事件数推导），client 节点据此
     * 判定首事件为 start、后续为 update（last-write-wins 折叠）。
     * @mode emit
     * @param data - 变更后的完整便签列表 + 会话内版本号。
     */
    'note/listed': NoteListedData
  }
}

export type { NoteListedData }
