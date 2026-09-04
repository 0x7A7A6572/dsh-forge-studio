/**
 * agent/tools —— 便签 agent 工具层单测。
 * 用 stub ctx（真 NotesService + 假 tools/on/get）验证：
 * - 6 个工具定义注册（list/get/create/update/set_pinned/delete）；
 * - guard 拒绝删除 origin='user' 的便签，放行 origin='agent' 与其它工具；
 * - pre-execute ask：写工具 + 宿主有 approval → ask；无 approval → next() 放行；
 *   读工具永远放行；
 * - create 经工具层创建落 origin='agent'。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NotesService } from '../src/service.ts'
import type { NoteId, NoteRecord } from '../src/types.ts'
import {
  installNotesTools,
  isNotesTool,
  isNotesWriteTool,
  notesDeleteGuard,
  NOTES_TOOL_PREFIX,
} from '../src/agent/tools.ts'

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

type FakeDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render: (...args: unknown[]) => unknown }
  execute: (...args: unknown[]) => Promise<unknown>
}

interface FakeTools {
  register: (def: unknown) => void
  guard: (fn: unknown) => void
}

interface Harness {
  notes: NotesService
  table: KvTable<NoteId, NoteRecord>
  ctx: Context
  registered: FakeDefinition[]
  guards: Array<(exec: unknown) => string | undefined>
  preExecutes: Array<(exec: unknown, next: () => unknown) => Promise<unknown>>
  /** 宿主 approval seam 开关（控制 get('approval') 返回值）。 */
  approval: boolean
}

function makeHarness(): Harness {
  const ctx = new Context()
  const table = fakeTable()
  const domain = { table: (name: string) => (name === 'notes' ? table : undefined) } as never
  const notes = new NotesService(ctx, { domain })
  const registered: FakeDefinition[] = []
  const guards: Harness['guards'] = []
  const preExecutes: Harness['preExecutes'] = []
  const state = { approval: false }
  const fakeTools: FakeTools = {
    register: (def) => { registered.push(def as FakeDefinition) },
    guard: (fn) => { guards.push(fn as Harness['guards'][number]) },
  }
  const fakeCtx = {
    notes,
    tools: fakeTools,
    on: (_name: string, fn: (exec: unknown, next: () => unknown) => Promise<unknown>) => {
      preExecutes.push(fn)
      return () => {}
    },
    get: (key: string) => (key === 'approval' ? (state.approval ? {} : undefined) : undefined),
  } as unknown as Context

  installNotesTools(fakeCtx)
  return {
    notes,
    table,
    ctx: fakeCtx,
    registered,
    guards,
    preExecutes,
    get approval() { return state.approval },
    set approval(v: boolean) { state.approval = v },
  }
}

const execOf = (name: string, args: unknown) => ({ name, arguments: args })

describe('notes agent 工具注册', () => {
  it('注册 6 个 notes_* 工具（读 2 + 写 4）', () => {
    const { registered } = makeHarness()
    const names = registered.map(d => d.name).sort()
    expect(names).toEqual([
      `${NOTES_TOOL_PREFIX}create`,
      `${NOTES_TOOL_PREFIX}delete`,
      `${NOTES_TOOL_PREFIX}get`,
      `${NOTES_TOOL_PREFIX}list`,
      `${NOTES_TOOL_PREFIX}set_pinned`,
      `${NOTES_TOOL_PREFIX}update`,
    ])
  })

  it('读工具放行、写工具需审批的判定函数', () => {
    expect(isNotesTool('notes_list')).toBe(true)
    expect(isNotesTool('notes_create')).toBe(true)
    expect(isNotesTool('other_tool')).toBe(false)
    expect(isNotesWriteTool('notes_list')).toBe(false)
    expect(isNotesWriteTool('notes_create')).toBe(true)
    expect(isNotesWriteTool('notes_delete')).toBe(true)
  })
})

describe('notes_delete guard', () => {
  it('拒绝 agent 删除 user 手写便签', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ title: 't', text: 'b' }) // origin 默认 user
    const reason = h.guards[0]?.(execOf('notes_delete', { note_id: note.id }))
    expect(reason).toMatch(/written by the user/)
  })

  it('放行删除 agent 自己创建的便签', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ title: 't', text: 'b', origin: 'agent' })
    const reason = h.guards[0]?.(execOf('notes_delete', { note_id: note.id }))
    expect(reason).toBeUndefined()
  })

  it('其它工具或缺失 id 不触发 guard', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ title: 't', text: 'b' })
    expect(h.guards[0]?.(execOf('notes_update', { note_id: note.id }))).toBeUndefined()
    expect(h.guards[0]?.(execOf('notes_delete', {}))).toBeUndefined()
    expect(h.guards[0]?.(execOf('notes_delete', { note_id: 42 }))).toBeUndefined()
  })
})

describe('notes pre-execute ask 策略', () => {
  async function decide(h: Harness, name: string, args: unknown): Promise<string> {
    const listener = h.preExecutes[0]
    if (!listener) throw new Error('no pre-execute listener')
    let forwarded = false
    const decision = await listener(execOf(name, args), async () => {
      forwarded = true
      return { kind: 'allow' }
    })
    if (forwarded) return 'next'
    return JSON.stringify(decision)
  }

  it('宿主有 approval：写工具返回 ask，读工具放行', async () => {
    const h = makeHarness()
    h.approval = true
    for (const name of ['notes_create', 'notes_update', 'notes_set_pinned', 'notes_delete']) {
      const decision = await decide(h, name, {})
      expect(decision).toMatch(/^\{.*"kind":"ask"/)
    }
    expect(await decide(h, 'notes_list', {})).toBe('next')
    expect(await decide(h, 'notes_get', {})).toBe('next')
  })

  it('宿主无 approval seam：写工具放行（unconditional，guard 兜底）', async () => {
    const h = makeHarness()
    expect(await decide(h, 'notes_create', {})).toBe('next')
    expect(await decide(h, 'notes_delete', {})).toBe('next')
  })

  it('非 notes 工具不受影响', async () => {
    const h = makeHarness()
    h.approval = true
    expect(await decide(h, 'bash', {})).toBe('next')
  })
})

describe('notes 工具 execute 语义', () => {
  it('notes_create 创建的便签 origin=agent', async () => {
    const h = makeHarness()
    const tool = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}create`)
    expect(tool).toBeDefined()
    const created = await tool!.execute({ title: 'agent 笔记', text: 'body' }, {})
    expect((created as NoteRecord).origin).toBe('agent')
    expect(h.notes.list()).toHaveLength(1)
  })

  it('notes_delete 走真实服务删除（guard 在宿主层拦截 user 便签）', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ title: 't', text: 'b', origin: 'agent' })
    const tool = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}delete`)
    const result = await tool!.execute({ note_id: note.id }, {})
    expect(result).toEqual({ deleted: true, id: note.id })
    expect(h.notes.list()).toHaveLength(0)
  })
})

describe('notes 读工具 lane 透出', () => {
  it('notes_list / notes_get 输出 schema 含 lane 字段', () => {
    const h = makeHarness()
    const list = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}list`)!
    const listSchema = list.output.schema as { properties: { notes: { items: { properties: Record<string, unknown> } } } }
    expect(listSchema.properties.notes.items.properties.lane).toBeDefined()
    const get = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}get`)!
    const getSchema = get.output.schema as { properties: Record<string, unknown> }
    expect(getSchema.properties.lane).toBeDefined()
  })

  it('noteText 渲染携带 lane 状态与 run（startedAt/summary）', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ title: 't', text: 'body', laneStatus: 'todo' })
    await h.notes.update(note.id, { lane: { status: 'running', run: { startedAt: 42, summary: 'almost there' } } })
    const updated = h.notes.list().find(n => n.id === note.id)!
    const get = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}get`)!
    const rendered = get.output.render({}, updated) as Array<{ type: string; text: string }>
    expect(rendered[0].text).toContain('(task: running')
    expect(rendered[0].text).toContain('run@42')
    expect(rendered[0].text).toContain('almost there')
  })
})
