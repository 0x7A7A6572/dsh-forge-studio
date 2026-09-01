import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { NoteRecord } from '../src/types.ts'
import { NOTE_BOARD_ID, noteListDefinition, foldNoteListed } from '../src/client/note-list-definition.ts'

function listed(revision: number, notes: NoteRecord[] = []): SessionEvent<'note/listed'> {
  return { type: 'note/listed', seq: revision, time: revision, data: { revision, notes } }
}

function note(id: string): NoteRecord {
  return { id: id as NoteRecord['id'], title: id, text: 'b', pinned: false, createdAt: 1, updatedAt: 1 }
}

describe('note-list definition', () => {
  it('revision 1 匹配为 start，后续为 update', () => {
    expect(noteListDefinition.match(listed(1, [note('a')]))).toEqual({ id: NOTE_BOARD_ID, role: 'start' })
    expect(noteListDefinition.match(listed(2, []))).toEqual({ id: NOTE_BOARD_ID, role: 'update' })
    expect(noteListDefinition.match({ type: 'user/message', seq: 9, time: 9, data: { text: 'hi' } } as SessionEvent)).toBeNull()
  })

  it('start/update 折叠快照（last-write-wins）', () => {
    const start = noteListDefinition.start!({} as never, { event: listed(1, [note('a')]) } as never, {} as never)
    expect(start.notes.map((n) => n.id)).toEqual(['a'])

    const next = noteListDefinition.update!({ state: start } as never, { event: listed(2, [note('a'), note('b')]) } as never)
    expect(next.notes.map((n) => n.id)).toEqual(['a', 'b'])

    const cleared = noteListDefinition.update!({ state: next } as never, { event: listed(3, []) } as never)
    expect(cleared.notes).toEqual([])
  })

  it('buildViewNode 锚定首事件并携带折叠状态', () => {
    const events = [listed(1, [note('a')]), listed(2, [note('a'), note('b')])]
    const context = {
      start: { event: events[0], location: { kind: 'turn', turn: {} } },
      matches: events.map((e) => ({ event: e, role: e.data.revision === 1 ? 'start' : 'update' })),
      state: { revision: 2, notes: [note('a'), note('b')] },
    } as never
    const node = noteListDefinition.buildViewNode!(context) as ChatConversationViewNode | null
    expect(node).not.toBeNull()
    expect(node!.kind).toBe('note-list')
    expect(node!.anchorSeq).toBe(1)
    expect((node!.data as { notes: NoteRecord[] }).notes).toHaveLength(2)
  })

  it('窗口中部开始时（无 start）仍能回退渲染最近快照', () => {
    const event = listed(5, [note('x')])
    const context = {
      start: undefined,
      matches: [{ event, role: 'update' as const }],
      state: undefined,
    } as never
    const node = noteListDefinition.buildViewNode!(context) as ChatConversationViewNode | null
    expect(node).not.toBeNull()
    expect(node!.anchorSeq).toBe(5)
    expect((node!.data as { notes: NoteRecord[] }).notes.map((n) => n.id)).toEqual(['x'])
  })

  it('foldNoteListed 对无关事件返回原状态', () => {
    const state = { revision: 1, notes: [note('a')] }
    expect(foldNoteListed(state, { type: 'user/message', seq: 9, time: 9, data: { text: 'x' } } as SessionEvent)).toBe(state)
    expect(foldNoteListed(undefined, { type: 'user/message', seq: 9, time: 9, data: { text: 'x' } } as SessionEvent)).toBeUndefined()
  })
})
