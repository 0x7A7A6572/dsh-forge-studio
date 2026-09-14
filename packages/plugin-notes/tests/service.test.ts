import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NotesService } from '../src/service.ts'
import type { NotesServiceConfig, NotesTaskRuntime } from '../src/service.ts'
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

function makeService(task?: NotesServiceConfig['task']): {
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
  const notes = new NotesService(ctx, { domain, ...(task ? { task } : {}) })
  return { notes, table, leases }
}

/**
 * 任务执行运行时假体：新建会话返回递增的 sess-N（记录收到的 cwd），prompt 记账；
 * 可按需注入默认工作区、默认候选，或让 create/prompt 抛错（测回滚路径）。
 */
function fakeRuntime(input: {
  readonly defaultWorkspace?: string
  readonly workspaces?: readonly string[]
  readonly failCreate?: boolean
  readonly failPrompt?: boolean
  readonly onPrompt?: (payload: {
    readonly noteId: NoteId
    readonly sessionId: string
    readonly workspace: string
  }) => void
} = {}): NotesTaskRuntime {
  let seq = 0
  return {
    async createSession({ workspace }) {
      if (input.failCreate === true) throw new Error('createSession boom')
      seq += 1
      return `sess-${seq}:${workspace}`
    },
    async prompt(payload) {
      if (input.failPrompt === true) throw new Error('prompt boom')
      input.onPrompt?.(payload)
    },
    async listWorkspaces() {
      return input.workspaces ?? []
    },
    /** host 侧三层兜底是运行时自己的事；假体只按输入给值（未给 = 连兜底都没有）。 */
    async defaultWorkspace() {
      return input.defaultWorkspace
    },
  }
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

  it('工作区：create 落 trim 值（空串不落字段）；update 覆盖/保留/空串清除', async () => {
    const { notes } = makeService()
    const created = await notes.create({ text: 'b', laneStatus: 'todo', workspace: '  D:/proj  ' })
    expect(created.workspace).toBe('D:/proj')
    // 空串/纯空白 = 未指定：字段不落（执行时回退设置默认值）
    const blank = await notes.create({ text: 'b', workspace: '   ' })
    expect(blank.workspace).toBeUndefined()
    // 给值即覆盖
    expect((await notes.update(created.id, { workspace: 'D:/other' }))?.workspace).toBe('D:/other')
    // 未给 workspace 的 patch 保留原值
    expect((await notes.update(created.id, { text: 'x' }))?.workspace).toBe('D:/other')
    // 空串 = 清除该字段
    expect((await notes.update(created.id, { workspace: '' }))?.workspace).toBeUndefined()
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

  it('update 可 patch lane.status 且保留 lane.run（已收尾的 run）', async () => {
    const { notes } = makeService()
    const created = await notes.create({ text: 'x', laneStatus: 'todo' })
    expect(created.lane).toEqual({ status: 'todo' })
    // 已收尾的 run（finishedAt 已落）：改状态不触发接管收尾，run 原样保留。
    const run = { startedAt: 1, finishedAt: 2, ok: true, summary: 'prior' }
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

describe('NotesService lane.clear（取消任务）', () => {
  it('update lane.clear 移除 lane 并撤销租约', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1') // → running + lease
    expect(leases.get(n.id)).toBeDefined()
    const after = await notes.update(n.id, { lane: { clear: true } })
    expect(after?.lane).toBeUndefined()
    expect(notes.list().find((x) => x.id === n.id)!.lane).toBeUndefined()
    expect(leases.get(n.id)).toBeUndefined()
  })

  it('lane.clear 与 status 并存时 clear 优先（status 被忽略）', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    const after = await notes.update(n.id, { lane: { clear: true, status: 'done' } })
    expect(after?.lane).toBeUndefined()
    expect(notes.list().find((x) => x.id === n.id)!.lane).toBeUndefined()
  })

  it('无 lane 便签 + clear 为 no-op 不报错', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x' })
    const after = await notes.update(n.id, { lane: { clear: true } })
    expect(after?.lane).toBeUndefined()
    expect(notes.list().find((x) => x.id === n.id)!.lane).toBeUndefined()
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
      run: { startedAt: expect.any(Number), by: 'user' },
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

describe('NotesService 执行事务（taskExecute/taskReset）', () => {
  it('taskExecute：按设置默认工作区新建会话 → 租约绑新会话 → 投递；运行中再次执行 busy', async () => {
    const prompted: Array<{ noteId: string; sessionId: string; workspace: string }> = []
    const { notes, leases } = makeService(fakeRuntime({
      defaultWorkspace: 'D:/ws',
      onPrompt: (payload) => prompted.push({
        noteId: payload.noteId,
        sessionId: payload.sessionId,
        workspace: payload.workspace,
      }),
    }))
    const n = await notes.create({ text: 't', laneStatus: 'todo' })
    const r1 = await notes.taskExecute(n.id)
    expect(r1).toMatchObject({ ok: true })
    expect((r1 as { note: NoteRecord }).note.lane?.status).toBe('running')
    expect((r1 as { note: NoteRecord }).note.lane?.run).toBeDefined()
    // 执行租约绑定**新会话** id（agent 在新会话里 report 才通过租约校验）。
    expect(leases.get(n.id)?.sessionId).toBe('sess-1:D:/ws')
    expect(prompted).toEqual([{ noteId: n.id, sessionId: 'sess-1:D:/ws', workspace: 'D:/ws' }])
    // 第二次执行：已有 active lease（运行中）→ busy
    expect(await notes.taskExecute(n.id)).toMatchObject({ ok: false, reason: 'busy' })
  })

  it('便签级 workspace 优先于设置默认工作区', async () => {
    const prompted: Array<{ workspace: string }> = []
    const { notes, leases } = makeService(fakeRuntime({
      defaultWorkspace: 'D:/default',
      onPrompt: (payload) => prompted.push({ workspace: payload.workspace }),
    }))
    const n = await notes.create({ text: 't', laneStatus: 'todo', workspace: 'D:/project' })
    expect((await notes.taskExecute(n.id)).ok).toBe(true)
    expect(prompted).toEqual([{ workspace: 'D:/project' }])
    expect(leases.get(n.id)?.sessionId).toContain('D:/project')
  })

  it('便签与设置都无工作区 → missing-workspace（不新建会话、不改状态、不写租约）', async () => {
    const { notes, leases } = makeService(fakeRuntime())
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    expect(await notes.taskExecute(n.id)).toMatchObject({ ok: false, reason: 'missing-workspace' })
    expect(leases.get(n.id)).toBeUndefined()
    expect(notes.list().find((x) => x.id === n.id)!.lane).toEqual({ status: 'todo' })
  })

  it('prompt 抛错 → dispatch-failed 且回滚原 lane（含 run）', async () => {
    const { notes, leases } = makeService(fakeRuntime({ defaultWorkspace: 'D:/ws', failPrompt: true }))
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    const priorRun = { startedAt: 1, finishedAt: 2, ok: true, summary: 'prior' }
    await notes.update(n.id, { lane: { status: 'done', run: priorRun } })
    const r = await notes.taskExecute(n.id)
    expect(r).toMatchObject({ ok: false, reason: 'dispatch-failed' })
    expect(leases.get(n.id)).toBeUndefined()
    // 回滚：lane 精确恢复 grant 前的 status + run
    expect(notes.list().find((x) => x.id === n.id)!.lane).toEqual({ status: 'done', run: priorRun })
  })

  it('新建会话抛错 → dispatch-failed 且状态未动（无租约、lane 原样）', async () => {
    const { notes, leases } = makeService(fakeRuntime({ defaultWorkspace: 'D:/ws', failCreate: true }))
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    expect(await notes.taskExecute(n.id)).toMatchObject({ ok: false, reason: 'dispatch-failed' })
    expect(leases.get(n.id)).toBeUndefined()
    expect(notes.list().find((x) => x.id === n.id)!.lane).toEqual({ status: 'todo' })
  })

  it('无 task 运行时 → no-dispatch 且状态未动', async () => {
    const { notes, leases } = makeService() // 未注入运行时
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    const r = await notes.taskExecute(n.id)
    expect(r).toMatchObject({ ok: false, reason: 'no-dispatch' })
    expect(leases.get(n.id)).toBeUndefined()
    expect(notes.list().find((x) => x.id === n.id)!.lane).toEqual({ status: 'todo' })
  })

  it('不存在的便签 → missing', async () => {
    const { notes } = makeService(fakeRuntime({ defaultWorkspace: 'D:/ws' }))
    expect(await notes.taskExecute('nope' as NoteId)).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('归档便签 → busy（T4 forward-minor b）', async () => {
    const { notes } = makeService(fakeRuntime({ defaultWorkspace: 'D:/ws' }))
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.update(n.id, { archived: true })
    expect(await notes.taskExecute(n.id)).toMatchObject({ ok: false, reason: 'busy' })
  })

  it('无 lane 普通便签 → busy', async () => {
    const { notes } = makeService(fakeRuntime({ defaultWorkspace: 'D:/ws' }))
    const n = await notes.create({ text: 'x' })
    expect(await notes.taskExecute(n.id)).toMatchObject({ ok: false, reason: 'busy' })
  })

  it('listWorkspaces：转发运行时候选；无运行时/运行时抛错都降级空数组', async () => {
    const withRuntime = makeService(fakeRuntime({ workspaces: ['D:/a', 'D:/b'] }))
    expect(await withRuntime.notes.listWorkspaces()).toEqual(['D:/a', 'D:/b'])
    const none = makeService()
    expect(await none.notes.listWorkspaces()).toEqual([])
    const broken = makeService({
      ...fakeRuntime(),
      async listWorkspaces() { throw new Error('boom') },
    })
    expect(await broken.notes.listWorkspaces()).toEqual([])
  })

  it('taskReset 撤销租约 + 收尾 run + 状态回 todo', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1') // → running + 新 run 帧
    const r = await notes.taskReset(n.id)
    expect(r).toMatchObject({ ok: true })
    expect(leases.get(n.id)).toBeUndefined()
    const lane = notes.list().find((x) => x.id === n.id)!.lane
    expect(lane?.status).toBe('todo')
    expect(lane?.run).toMatchObject({ ok: false, summary: '用户手动接管' })
    expect(lane?.run?.finishedAt).toBeGreaterThan(0)
    expect((r as { note: NoteRecord }).note.lane?.status).toBe('todo')
  })

  it('taskReset 不存在便签 → ok:false', async () => {
    const { notes } = makeService()
    expect(await notes.taskReset('nope' as NoteId)).toEqual({ ok: false })
  })
})

describe('NotesService update 手动接管收尾（M3：status 变更 + 开 run → settle）', () => {
  it('接管到 done：收尾开着 run 的帧并撤销租约', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1') // → running + 新 run 帧（open）+ lease
    const before = notes.list().find((x) => x.id === n.id)!
    expect(before.lane?.run?.finishedAt).toBeUndefined() // 开着
    const after = await notes.update(n.id, { lane: { status: 'done' } })
    expect(after?.lane?.status).toBe('done')
    expect(after?.lane?.run?.finishedAt).toBeGreaterThan(0)
    expect(after?.lane?.run?.ok).toBe(false)
    expect(after?.lane?.run?.summary).toBe('用户手动接管')
    expect(after?.lane?.run?.startedAt).toBe(before.lane?.run?.startedAt) // 原帧 startedAt 保留
    expect(leases.get(n.id)).toBeUndefined()
  })

  it('接管不改动已收尾的 run（finishedAt 已落）', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    const run = { startedAt: 1, finishedAt: 2, ok: true, summary: 'prior' }
    await notes.update(n.id, { lane: { status: 'running', run } })
    const after = await notes.update(n.id, { lane: { status: 'done' } })
    expect(after?.lane).toEqual({ status: 'done', run })
  })

  it('接管不改动无 run 的 lane（不凭空造 run）', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    const after = await notes.update(n.id, { lane: { status: 'done' } })
    expect(after?.lane).toEqual({ status: 'done' })
  })

  it('clear 仍删除 lane（开着 run 的便签不炸，run 随 lane 消失）', async () => {
    const { notes, leases } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1') // → running + open run + lease
    const after = await notes.update(n.id, { lane: { clear: true } })
    expect(after?.lane).toBeUndefined()
    expect(notes.list().find((x) => x.id === n.id)!.lane).toBeUndefined()
    expect(leases.get(n.id)).toBeUndefined()
  })
})

describe('NotesService agent 任务助手（setTaskStatus 通道收窄）', () => {
  it('setTaskStatus 非 running 抛错（defense in depth）', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1')
    await expect(notes.setTaskStatus(n.id, 'done')).rejects.toThrow(/set_status 仅允许置为 running/)
    await expect(notes.setTaskStatus(n.id, 'failed')).rejects.toThrow(/set_status 仅允许置为 running/)
  })

  it('setTaskStatus(running) 已 running 时为 no-op（不新建 run 帧）', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo' })
    await notes.grantTaskLease(n.id, 's1') // → running + run 帧
    const before = notes.list().find((x) => x.id === n.id)!.lane
    const after = await notes.setTaskStatus(n.id, 'running')
    expect(after?.lane).toEqual(before)
  })
})

describe('NotesService 定时日程', () => {
  it('create 带 laneStatus + schedule：落日程并把 nextAt 对齐到未来', async () => {
    const { notes } = makeService()
    const before = Date.now()
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'interval', everyMin: 30 } });
    expect(n.schedule?.enabled).toBe(true);
    expect(n.schedule?.nextAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(n.schedule?.nextAt).toBeLessThan(before + 30 * 60_000 + 5_000);
  })

  it('create 普通便签（无 laneStatus）忽略 schedule（无 lane 则日程无意义）', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', schedule: { enabled: true, mode: 'daily', time: '09:00' } });
    expect(n.lane).toBeUndefined();
    expect(n.schedule).toBeUndefined();
  })

  it('create 语义非法 schedule 抛错（不静默丢弃）', async () => {
    const { notes } = makeService()
    await expect(notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'once' } })).rejects.toThrow(/schedule 参数非法/);
  })

  it('update 给对象即整体替换并按 now 重算 nextAt，保留宿主已记录的最近派发信息', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'interval', everyMin: 30 } });
    await notes.setSchedule(n.id, { ...n.schedule!, lastFiredAt: 111, lastResult: '已派发' });
    const before = Date.now();
    const after = await notes.update(n.id, { schedule: { enabled: true, mode: 'daily', time: '09:00' } });
    expect(after?.schedule?.mode).toBe('daily');
    expect(after?.schedule?.everyMin).toBeUndefined();
    expect(after?.schedule?.lastResult).toBe('已派发');
    expect(after?.schedule?.nextAt).toBeGreaterThan(before);
  })

  it('update schedule=null 清除日程；未给则保留', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'daily', time: '09:00' } });
    const kept = await notes.update(n.id, { title: '改标题' });
    expect(kept?.schedule?.mode).toBe('daily');
    const cleared = await notes.update(n.id, { schedule: null });
    expect(cleared?.schedule).toBeUndefined();
  })

  it('取消任务（lane.clear）连带清除日程', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'daily', time: '09:00' } });
    const after = await notes.update(n.id, { lane: { clear: true } });
    expect(after?.lane).toBeUndefined();
    expect(after?.schedule).toBeUndefined();
  })

  it('update 语义非法 schedule 抛错且不改库', async () => {
    const { notes } = makeService()
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'daily', time: '09:00' } });
    await expect(notes.update(n.id, { title: '新标题', schedule: { enabled: true, mode: 'weekly', time: '09:00', weekdays: [] } })).rejects.toThrow(/schedule 参数非法/);
    const fresh = notes.list().find((x) => x.id === n.id)!;
    expect(fresh.title).toBe(n.title);
    expect(fresh.schedule?.mode).toBe('daily');
  })

  it('setSchedule 直写日程且不触碰 lane 与租约（running 期间写回安全）', async () => {
    const { notes, leases } = makeService(fakeRuntime({ defaultWorkspace: 'C:/ws' }));
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'interval', everyMin: 60 } });
    const started = await notes.taskExecute(n.id);
    expect(started.ok).toBe(true);
    expect(leases.get(n.id)).toBeDefined();
    const running = notes.list().find((x) => x.id === n.id)!;
    const written = await notes.setSchedule(n.id, { ...running.schedule!, lastFiredAt: 42, lastResult: '已派发' });
    expect(written?.lane?.status).toBe('running');
    expect(written?.lane?.run).toEqual(running.lane?.run);
    expect(leases.get(n.id)).toBeDefined();
    expect(notes.list().find((x) => x.id === n.id)!.schedule?.lastResult).toBe('已派发');
  })

  it('循环日程收尾落回待办（结果照写），一次性照常落完成/失败', async () => {
    const { notes } = makeService();
    const loop = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'daily', time: '09:00' } });
    const once = await notes.create({ text: 'y', laneStatus: 'todo', schedule: { enabled: true, mode: 'once', at: Date.now() + 60_000 } });
    await notes.grantTaskLease(loop.id, 's1');
    await notes.grantTaskLease(once.id, 's2');
    const settledLoop = await notes.settleTaskRun(loop.id, true, '跑完了');
    expect(settledLoop?.lane?.status).toBe('todo');
    expect(settledLoop?.lane?.run?.ok).toBe(true);
    expect(settledLoop?.lane?.run?.summary).toBe('跑完了');
    const settledOnce = await notes.settleTaskRun(once.id, false, '炸了');
    expect(settledOnce?.lane?.status).toBe('failed');
  })

  it('停用的日程不算循环：收尾照常落完成', async () => {
    const { notes } = makeService();
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: false, mode: 'daily', time: '09:00' } });
    await notes.grantTaskLease(n.id, 's1');
    const settled = await notes.settleTaskRun(n.id, true, 'ok');
    expect(settled?.lane?.status).toBe('done');
  })
})

describe('NotesService 错误边界（失败连击 / 错误发起方标记）', () => {
  it('循环日程运行失败累加连击，到上限自动停用', async () => {
    const { notes } = makeService();
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'daily', time: '09:00' } });
    for (let i = 1; i <= 2; i++) {
      await notes.grantTaskLease(n.id, `s${i}`);
      const settled = await notes.settleTaskRun(n.id, false, '炸了');
      expect(settled?.schedule?.enabled).toBe(true);
      expect(settled?.schedule?.failureStreak).toBe(i);
    }
    await notes.grantTaskLease(n.id, 's3');
    const killed = await notes.settleTaskRun(n.id, false, '炸了');
    expect(killed?.schedule?.enabled).toBe(false);
    expect(killed?.schedule?.failureStreak).toBe(3);
    expect(killed?.schedule?.lastResult).toBe('连续 3 次失败，已停用');
  })

  it('运行成功清零连击（循环日程继续跑）', async () => {
    const { notes } = makeService();
    const n = await notes.create({ text: 'x', laneStatus: 'todo', schedule: { enabled: true, mode: 'daily', time: '09:00' } });
    await notes.grantTaskLease(n.id, 's1');
    await notes.settleTaskRun(n.id, false, '炸了');
    await notes.grantTaskLease(n.id, 's2');
    const ok = await notes.settleTaskRun(n.id, true, '好了');
    expect(ok?.schedule?.failureStreak).toBe(0);
    expect(ok?.schedule?.enabled).toBe(true);
  })

  it('taskExecute 标 by=user，taskExecuteScheduled 标 by=schedule（超时兜底据此认领）', async () => {
    const { notes } = makeService(fakeRuntime({ defaultWorkspace: 'D:/ws' }));
    const manual = await notes.create({ text: 'a', laneStatus: 'todo' });
    const scheduled = await notes.create({ text: 'b', laneStatus: 'todo' });
    const r1 = await notes.taskExecute(manual.id);
    const r2 = await notes.taskExecuteScheduled(scheduled.id);
    expect((r1 as { note: NoteRecord }).note.lane?.run?.by).toBe('user');
    expect((r2 as { note: NoteRecord }).note.lane?.run?.by).toBe('schedule');
  })
})
