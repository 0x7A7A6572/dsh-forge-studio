/**
 * NotesService 变更通知（事件驱动）：宿主每次写操作后，notes/watch 流的订阅者
 * 应收到一次变更事件。本测试直接消费 service.watch(signal)（不经 Typert wire，
 * wire 层由 remote.test 的 descriptor/marker 一致性测试覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NotesService } from '../src/service.ts'
import type { NotesServiceConfig } from '../src/service.ts'
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

/** 一次带超时的 next；返回 null 表示超时/结束。 */
async function nextOrNull<T>(
  iterator: AsyncIterator<T>,
  ctl: AbortController,
  timeoutMs = 1500,
): Promise<IteratorResult<T> | null> {
  const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
  const step = await Promise.race([iterator.next(), timer])
  return step === 'timeout' ? null : step
}

/** 收尾：先 abort（结算 generator 内部等待）再 return，避免 return() 永不收束。 */
async function closeGen<T>(gen: AsyncGenerator<T>, ctl: AbortController): Promise<void> {
  ctl.abort()
  const iterator = gen[Symbol.asyncIterator]()
  await iterator.return?.(undefined)
}

describe('NotesService 变更通知（notes/watch）', () => {
  it('create/update/delete 各自触发一次带 changedAt 的通知（arm-before-op）', async () => {
    const { notes } = makeService()
    const ctl = new AbortController()
    const gen = notes.watch(ctl.signal)
    const iterator = gen[Symbol.asyncIterator]()
    try {
      // 每步先武装 next（同步注册等待），再执行操作——避免广播与重新武装的竞态。
      let step = nextOrNull(iterator, ctl)
      const created = await notes.create({ title: 't', text: 'b' })
      let item = await step
      expect(item?.done).toBe(false)
      expect((item?.value as { changedAt: unknown }).changedAt).toBeTypeOf('number')

      step = nextOrNull(iterator, ctl)
      await notes.update(created.id, { text: 'b2' })
      item = await step
      expect(item?.done).toBe(false)

      step = nextOrNull(iterator, ctl)
      await notes.delete(created.id)
      item = await step
      expect(item?.done).toBe(false)
    } finally {
      await closeGen(gen, ctl)
    }
  })

  it('无变更时不产出事件（事件驱动，非心跳）', async () => {
    const { notes } = makeService()
    const ctl = new AbortController()
    const gen = notes.watch(ctl.signal)
    const iterator = gen[Symbol.asyncIterator]()
    const step = await nextOrNull(iterator, ctl, 80)
    expect(step).toBeNull() // 超时 = 无事件，而非收到心跳
    await closeGen(gen, ctl)
  })

  it('signal abort 后立即收尾且不再收到通知', async () => {
    const { notes } = makeService()
    const ctl = new AbortController()
    const gen = notes.watch(ctl.signal)
    const iterator = gen[Symbol.asyncIterator]()
    try {
      let step = nextOrNull(iterator, ctl)
      await notes.create({ title: 'a', text: '1' })
      const item = await step
      expect(item?.done).toBe(false)

      // 收尾后：再写不产生新事件（监听已清理），且 return 不再卡住。
      ctl.abort()
      await iterator.return?.(undefined)
      await notes.create({ title: 'b', text: '2' })
      await new Promise((resolve) => setTimeout(resolve, 30))
      // 已收尾的生成器：后续 next 立即 done（证明监听已清理、无事件再产出）。
      const after = await nextOrNull(iterator, ctl, 60)
      expect(after?.done).toBe(true)
    } finally {
      ctl.abort()
      await iterator.return?.(undefined)
    }
  })
})