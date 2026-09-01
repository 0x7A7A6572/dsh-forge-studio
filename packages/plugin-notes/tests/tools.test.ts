import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { NotesService } from '../src/service.ts'
import { defineNoteTools } from '../src/tools.ts'
import { defineNoteCommand } from '../src/commands.ts'
import type { NoteId, NoteListedData, NoteRecord } from '../src/types.ts'

/** 会话日志假件：events 数组 + append 记录。 */
function fakeSession() {
  const events: SessionEvent[] = []
  return {
    events,
    append(type: string, data: unknown): SessionEvent {
      const event = { type, seq: events.length + 1, time: Date.now(), data } as SessionEvent
      events.push(event)
      return event
    },
  }
}

function fakeExec(session: ReturnType<typeof fakeSession>): ToolRunContext {
  return { agent: { session } } as unknown as ToolRunContext
}

function makeHarness() {
  const ctx = new Context()
  const map = new Map<string, NoteRecord>()
  const domain = {
    table: () => ({
      get: (k: string) => map.get(k),
      entries: () => map.entries(),
      keys: () => map.keys(),
      get size() { return map.size },
      put: async (k: string, v: NoteRecord) => { map.set(k, v) },
      delete: async (k: string) => map.delete(k),
      update: async (k: string, fn: (v: NoteRecord) => NoteRecord) => {
        const cur = map.get(k)
        if (!cur) throw new Error('missing-key')
        const next = fn(cur)
        map.set(k, next)
        return next
      },
    }),
  } as never
  const notes = new NotesService(ctx, { domain })
  const harnessCtx = { notes } as unknown as Context
  return { ctx: harnessCtx, notes }
}

describe('notes tools', () => {
  it('notes_create 返回记录并追加 revision 1 快照', async () => {
    const { ctx } = makeHarness()
    const [create] = defineNoteTools(ctx)
    const session = fakeSession()
    const value = await create.execute?.({ title: 't', text: 'b' }, fakeExec(session))

    expect(value).toMatchObject({ title: 't', text: 'b' })
    expect(session.events).toHaveLength(1)
    expect(session.events[0]).toMatchObject({ type: 'note/listed', data: { revision: 1 } })
    expect((session.events[0]!.data as unknown as NoteListedData).notes).toHaveLength(1)
  })

  it('notes_delete 追加 revision 2 空列表快照', async () => {
    const { ctx } = makeHarness()
    const tools = defineNoteTools(ctx)
    const [create, , , del] = tools
    const session = fakeSession()
    const note = await create.execute?.({ title: 't', text: 'b' }, fakeExec(session))
    const ok = await del.execute?.({ id: (note as NoteRecord).id }, fakeExec(session))
    expect(ok).toEqual({ id: (note as NoteRecord).id })
    expect(session.events).toHaveLength(2)
    expect(session.events[1]).toMatchObject({ type: 'note/listed', data: { revision: 2 } })
    expect((session.events[1]!.data as unknown as NoteListedData).notes).toEqual([])
  })

  it('notes_update 缺参时拒绝', async () => {
    const { ctx } = makeHarness()
    const [, , update] = defineNoteTools(ctx)
    await expect(update.execute?.({ id: 'x' as NoteId }, fakeExec(fakeSession()))).rejects.toThrow(
      '至少需要',
    )
  })

  it('无 agent 时静默跳过事件写入', async () => {
    const { ctx } = makeHarness()
    const [create] = defineNoteTools(ctx)
    const exec = {} as unknown as ToolRunContext
    const note = await create.execute?.({ title: 't', text: 'b' }, exec)
    expect((note as NoteRecord).id).toBeTruthy()
  })
})

describe('/note command', () => {
  it('add 创建便签并写快照', async () => {
    const { ctx, notes } = makeHarness()
    const definition = defineNoteCommand(ctx)
    const session = fakeSession()
    const result = await definition.handler({ agent: { session }, rawInput: 'add 标题：正文' } as never)
    expect(result.kind).toBe('success')
    expect(notes.list()).toHaveLength(1)
    expect(session.events[0]).toMatchObject({ type: 'note/listed', data: { revision: 1 } })
  })

  it('rm 删除便签', async () => {
    const { ctx, notes } = makeHarness()
    const definition = defineNoteCommand(ctx)
    const session = fakeSession()
    await definition.handler({ agent: { session }, rawInput: 'add 标题' } as never)
    const id = notes.list()[0]!.id
    const result = await definition.handler({ agent: { session }, rawInput: `rm ${id}` } as never)
    expect(result.kind).toBe('success')
    expect(notes.list()).toHaveLength(0)
  })

  it('语法错误返回 error', async () => {
    const { ctx } = makeHarness()
    const definition = defineNoteCommand(ctx)
    const session = fakeSession()
    const result = await definition.handler({ agent: { session }, rawInput: 'rm' } as never)
    expect(result.kind).toBe('error')
  })

  it('revision 跨命令连续递增', async () => {
    const { ctx, notes } = makeHarness()
    const definition = defineNoteCommand(ctx)
    const session = fakeSession()
    await definition.handler({ agent: { session }, rawInput: 'add 一' } as never)
    await definition.handler({ agent: { session }, rawInput: 'add 二' } as never)
    const id = notes.list()[0]!.id
    await definition.handler({ agent: { session }, rawInput: `rm ${id}` } as never)
    expect(session.events.map((e) => (e.data as { revision: number }).revision)).toEqual([1, 2, 3])
  })
})
