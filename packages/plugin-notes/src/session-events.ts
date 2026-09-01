/**
 * 会话事件写入助手：把当前完整便签列表作为 note/listed 快照追加到会话日志。
 * revision 从会话日志已有 note/listed 事件数 + 1 推导 —— 会话恢复后自然续号，
 * client 节点可据此稳定区分 start（revision === 1）与 update。
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { NoteListedData, NoteRecord } from './types.ts'

/** 从会话日志计算下一条 note/listed 的 revision。 */
export function nextNoteListedRevision(session: Session): number {
  let count = 0
  for (const event of session.events) {
    if (event.type === 'note/listed') count++
  }
  return count + 1
}

/** 追加一条 note/listed 快照（整值检查点，last-write-wins）。 */
export function appendNoteListed(session: Session, notes: readonly NoteRecord[]): NoteListedData {
  const data: NoteListedData = { revision: nextNoteListedRevision(session), notes }
  session.append('note/listed', data)
  return data
}
