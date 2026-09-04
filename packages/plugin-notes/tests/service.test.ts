import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NotesService } from '../src/service.ts'
import type { TaskLease } from '../src/domain.ts'
import type { NoteId, NoteRecord } from '../src/types.ts'

function fakeTable<V>(): KvTable<NoteId, V> {
  const map = new Map<string, V>()
  return {
    get: (k) => map.get(k),
    entries: () => map.entries() as IterableIterator<[NoteId, V]>,
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

function makeService(): {
  notes: NotesService
  table: KvTable<NoteId, NoteRecord>
  leases: KvTable<NoteId, TaskLease>
} {
  const ctx = new Context()
  const table = fakeTable<NoteRecord>()
  const leases = fakeTable<TaskLease>()
  const domain = {
    table: (name: string) => (name === 'notes' ? table : name === 'leases' ? leases : undefined),
  } as never
  const notes = new NotesService(ctx, { domain })
  return { notes, table, leases }
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

  it('create 未传 color 时默认黄色', async () => {
    const { notes, table } = makeService()
    const note = await notes.create({ title: 't', text: 'b' })
    expect(note.color).toBe('yellow')
    expect(table.get(note.id)?.color).toBe('yellow')
  })

  it('create 可指定 color 并持久化', async () => {
    const { notes } = makeService()
    const note = await notes.create({ title: 't', text: 'b', color: 'pink' })
    expect(note.color).toBe('pink')
    expect(notes.list()[0]?.color).toBe('pink')
  })

  it('update 合并 color，未传则保留原值', async () => {
    const { notes } = makeService()
    const created = await notes.create({ title: 't', text: 'b' })
    const changed = await notes.update(created.id, { color: 'blue' })
    expect(changed?.color).toBe('blue')
    const untouched = await notes.update(created.id, { text: 'b2' })
    expect(untouched?.color).toBe('blue')
    expect(untouched?.title).toBe('t')
  })

  it('setPinned 不丢 color', async () => {
    const { notes } = makeService()
    const note = await notes.create({ title: 't', text: 'b', color: 'pink' })
    const pinned = await notes.setPinned(note.id, true)
    expect(pinned?.color).toBe('pink')
  })

  it('create 默认未归档', async () => {
    const { notes, table } = makeService()
    const note = await notes.create({ title: 't', text: 'b' })
    expect(note.archived).toBe(false)
    expect(table.get(note.id)?.archived).toBe(false)
  })

  it('update 可归档/恢复并持久化', async () => {
    const { notes, table } = makeService()
    const note = await notes.create({ title: 't', text: 'b' })
    const archived = await notes.update(note.id, { archived: true })
    expect(archived?.archived).toBe(true)
    expect(table.get(note.id)?.archived).toBe(true)
    const restored = await notes.update(note.id, { archived: false })
    expect(restored?.archived).toBe(false)
    expect(table.get(note.id)?.archived).toBe(false)
  })

  it('update 未带 archived 时保留原值（含 setPinned）', async () => {
    const { notes } = makeService()
    const note = await notes.create({ title: 't', text: 'b' })
    await notes.update(note.id, { archived: true })
    const untouched = await notes.update(note.id, { text: 'b2' })
    expect(untouched?.archived).toBe(true)
    const pinned = await notes.setPinned(note.id, true)
    expect(pinned?.archived).toBe(true)
    expect(pinned?.pinned).toBe(true)
  })

  it('list 包含归档便签（由 client 分区展示）', async () => {
    const { notes } = makeService()
    const a = await notes.create({ title: 'a', text: '1' })
    const b = await notes.create({ title: 'b', text: '2' })
    await notes.update(a.id, { archived: true })
    const all = notes.list()
    expect(all.map((n) => n.title)).toEqual(['a', 'b'])
    expect(all.find((n) => n.id === a.id)?.archived).toBe(true)
    expect(all.find((n) => n.id === b.id)?.archived).toBe(false)
  })
})

describe('NotesService lane 写入通道', () => {
  it('create 带 laneStatus 落 lane: { status } 并持久化', async () => {
    const { notes, table } = makeService()
    const note = await notes.create({ text: 'x', laneStatus: 'todo' })
    expect(note.lane).toEqual({ status: 'todo' })
    expect(table.get(note.id)?.lane).toEqual({ status: 'todo' })
  })

  it('create 不带 laneStatus 不落 lane 字段', async () => {
    const { notes } = makeService()
    const note = await notes.create({ text: 'x' })
    expect(note.lane).toBeUndefined()
  })

  it('update 可 patch lane.status 且保留 lane.run', async () => {
    const { notes } = makeService()
    const created = await notes.create({ text: 'x', laneStatus: 'todo' })
    expect(created.lane).toEqual({ status: 'todo' })
    const run = { startedAt: 1 }
    const withRun = await notes.update(created.id, { lane: { status: 'running', run } })
    expect(withRun?.lane).toEqual({ status: 'running', run })
    const statusOnly = await notes.update(created.id, { lane: { status: 'done' } })
    expect(statusOnly?.lane).toEqual({ status: 'done', run }) // run 保留
  })

  it('update lane.run 整体替换且保留 status', async () => {
    const { notes } = makeService()
    const created = await notes.create({ text: 'x', laneStatus: 'running' })
    const run1 = { startedAt: 1, ok: false }
    await notes.update(created.id, { lane: { run: run1 } })
    expect(notes.list()[0]?.lane).toEqual({ status: 'running', run: run1 })
    const run2 = { startedAt: 2, summary: 'done' }
    await notes.update(created.id, { lane: { run: run2 } })
    expect(notes.list()[0]?.lane).toEqual({ status: 'running', run: run2 }) // 整体替换，非逐字段合并
  })

  it('update lane 空 patch 对象为 no-op（不改动 lane）', async () => {
    const { notes } = makeService()
    const task = await notes.create({ text: 'x', laneStatus: 'todo' })
    const after = await notes.update(task.id, { lane: {} })
    expect(after?.lane).toEqual({ status: 'todo' })
    // 无 lane 的普通便签：空 patch 不凭空造 lane
    const plain = await notes.create({ text: 'y' })
    const plainAfter = await notes.update(plain.id, { lane: {} })
    expect(plainAfter?.lane).toBeUndefined()
  })

  it('update 仅给 run 无 status 且无当前 lane 时抛错（防无 status 的 lane）', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x' }) // 无 lane
    await expect(notes.update(n.id, { lane: { run: { startedAt: 1 } } })).rejects.toThrow(/status/)
    expect(notes.list()[0]?.lane).toBeUndefined()
  })
})

describe('NotesService 执行租约（grant/revoke）', () => {
  it('grant/revoke 与 busy 冲突', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 't', laneStatus: 'todo' })
    expect(await notes.grantTaskLease(n.id, 's1')).toBe('granted')
    expect(notes.list().find((x) => x.id === n.id)!.lane?.status).toBe('running')
    expect(await notes.grantTaskLease(n.id, 's2')).toBe('busy')
    expect(await notes.revokeTaskLease(n.id)).toBe(true)
    expect(await notes.revokeTaskLease(n.id)).toBe(false)
    expect(await notes.grantTaskLease(n.id, 's3')).toBe('granted')
  })

  it('grantTaskLease 对不存在的便签返回 missing', async () => {
    const { notes } = makeService()
    expect(await notes.grantTaskLease('nope' as NoteId, 's1')).toBe('missing')
  })

  it('grantTaskLease 对无 lane 的普通便签返回 busy', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x' })
    expect(await notes.grantTaskLease(n.id, 's1')).toBe('busy')
  })

  it('grant 写 leases 行并置 running + 新 run 帧', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1')
    expect(leases.get(n.id)).toEqual({
      noteId: n.id,
      sessionId: 's1',
      grantedAt: expect.any(Number),
    })
    expect(notes.list().find((x) => x.id === n.id)!.lane).toEqual({
      status: 'running',
      run: { startedAt: expect.any(Number) },
    })
  })

  it('revoke 只删 lease、不改 lane 状态', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1')
    expect(await notes.revokeTaskLease(n.id)).toBe(true)
    expect(leases.get(n.id)).toBeUndefined()
    // lane 仍为 running（revoke 不改状态，由调用方决定）
    expect(notes.list().find((x) => x.id === n.id)!.lane?.status).toBe('running')
  })

  it('手动 update lane.status 变更撤销租约', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1')
    expect(leases.get(n.id)).toBeDefined()
    await notes.update(n.id, { lane: { status: 'done' } })
    expect(leases.get(n.id)).toBeUndefined()
  })

  it('update lane.status 与当前相同不撤销租约', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1') // 置 running
    await notes.update(n.id, { lane: { status: 'running' } }) // 状态未变
    expect(leases.get(n.id)).toBeDefined()
  })

  it('归档撤销租约', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1')
    await notes.update(n.id, { archived: true })
    expect(leases.get(n.id)).toBeUndefined()
  })

  it('删除撤销租约', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1')
    await notes.delete(n.id)
    expect(leases.get(n.id)).toBeUndefined()
  })
})
