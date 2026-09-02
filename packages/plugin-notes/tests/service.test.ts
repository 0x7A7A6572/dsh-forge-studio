import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NotesService } from '../src/service.ts'
import type { NoteId, NoteRecord } from '../src/types.ts'

function fakeTable(): KvTable<NoteId, NoteRecord> {
  const map = new Map<string, NoteRecord>()
  return {
    get: (k) => map.get(k),
    entries: () => map.entries() as IterableIterator<[NoteId, NoteRecord]>,
    keys: () => map.keys() as IterableIterator<NoteId>,
    get size() { return map.size },
    put: async (k, v) => { map.set(k, v) },
    delete: async (k) => map.delete(k),
    update: async (k, fn) => {
      const cur = map.get(k)
      if (!cur) throw new Error('missing-key')
      const next = fn(cur)
      map.set(k, next)
      return next
    },
  }
}

function makeService(): { notes: NotesService; table: KvTable<NoteId, NoteRecord> } {
  const ctx = new Context()
  const table = fakeTable()
  const domain = { table: (name: string) => (name === 'notes' ? table : undefined) } as never
  const notes = new NotesService(ctx, { domain })
  return { notes, table }
}

describe('NotesService', () => {
  it('create 持久化记录并带默认标题/时间戳', async () => {
    const { notes, table } = makeService()
    const note = await notes.create({ title: '', text: 'hello' })
    expect(note.title).toBe('新便签')
    expect(note.pinned).toBe(false)
    expect(note.createdAt).toBeGreaterThan(0)
    expect(table.get(note.id)?.text).toBe('hello')
  })

  it('update 合并补丁并刷新 updatedAt', async () => {
    const { notes } = makeService()
    const created = await notes.create({ title: 't', text: 'b' })
    const updated = await notes.update(created.id, { text: 'b2' })
    expect(updated?.title).toBe('t')
    expect(updated?.text).toBe('b2')
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('update 不存在的 id 返回 undefined', async () => {
    const { notes } = makeService()
    expect(await notes.update('nope' as NoteId, { title: 'x' })).toBeUndefined()
  })

  it('delete 后 list 不再包含该便签', async () => {
    const { notes } = makeService()
    const note = await notes.create({ title: 't', text: 'b' })
    expect(await notes.delete(note.id)).toBe(true)
    expect(notes.list()).toEqual([])
    expect(await notes.delete(note.id)).toBe(false)
  })

  it('setPinned 切换置顶', async () => {
    const { notes } = makeService()
    const note = await notes.create({ title: 't', text: 'b' })
    const pinned = await notes.setPinned(note.id, true)
    expect(pinned?.pinned).toBe(true)
    expect(notes.list()[0]?.pinned).toBe(true)
  })
})
