/**
 * note-list 会话节点定义：折叠 note/listed 快照事件为一张便签板卡片。
 * revision === 1 的事件是该上下文的 start，其余为 update（last-write-wins）。
 * 事件窗口若从会话中部开始（首个可见事件 revision > 1），state 保持未定，
 * buildViewNode 回退到最近一条快照 —— 不会崩溃、也不会双 start。
 */

import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationMatch, ConversationMatchResult, ConversationNodeContext, ConversationNodeDefinition, ConversationStartMatch } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { NoteListedData, NoteRecord } from '../types.ts'

export interface NoteBoardViewData {
  readonly revision: number
  readonly notes: readonly NoteRecord[]
}

export const NOTE_LIST_KIND = 'note-list'
export const NOTE_BOARD_ID = 'board'

/**
 * 上下文 key 的规范格式（与运行时 conversationContextKey 一致，避免把
 * dsh-client-runtime 引入 bundle —— 该模块由平台提供，不打包）。
 */
export function conversationContextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`
}

// 把便签板载荷并入 Chat 渲染器 payload 注册表（type-only 合并，无运行时依赖）。
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'note-list': NoteBoardViewData
  }
}

function dataOf(event: SessionEventLike): NoteListedData | undefined {
  return event.type === 'note/listed' ? event.data : undefined
}

/** 折叠后的便签板状态（供 ChatNodeDataMap 消费，见 index.ts 的模块合并）。 */
export function foldNoteListed(state: NoteBoardViewData | undefined, event: SessionEventLike): NoteBoardViewData | undefined {
  const data = dataOf(event)
  if (!data) return state
  return { revision: data.revision, notes: data.notes }
}

export const noteListDefinition: ConversationNodeDefinition<NoteBoardViewData> = {
  kind: NOTE_LIST_KIND,
  target: 'chat',
  match(event: SessionEventLike): ConversationMatchResult | null {
    if (event.type !== 'note/listed') return null
    return {
      id: NOTE_BOARD_ID,
      // 首条快照（会话内 revision 1）启动便签板；窗口中部开始的会话只会看到
      // update，此时无 start、无状态 —— buildViewNode 回退渲染，不抛错。
      role: event.data.revision === 1 ? 'start' : 'update',
    }
  },
  start(_context: ConversationNodeContext<NoteBoardViewData>, match: ConversationStartMatch): NoteBoardViewData {
    const data = (match.event as SessionEvent<'note/listed'>).data
    return { revision: data.revision, notes: data.notes }
  },
  update(context: ConversationNodeContext<NoteBoardViewData> & { readonly state: NoteBoardViewData }, match: ConversationMatch): NoteBoardViewData {
    const data = (match.event as SessionEvent<'note/listed'>).data
    return { revision: data.revision, notes: data.notes }
  },
  buildViewNode(context: ConversationNodeContext<NoteBoardViewData>): ChatConversationViewNode | null {
    const start = context.start
    const first = context.matches[0]
    if (!first) return null
    const state = context.state ?? foldNoteListed(undefined, first.event)
    if (!state) return null
    return {
      key: conversationContextKey(NOTE_LIST_KIND, NOTE_BOARD_ID),
      kind: NOTE_LIST_KIND,
      id: NOTE_BOARD_ID,
      target: 'chat',
      anchorSeq: start?.event.seq ?? first.event.seq,
      location: start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: state,
    }
  },
}
