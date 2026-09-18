/**
 * agent/tools —— 便签 agent 工具层单测。
 * 用 stub ctx（真 NotesService + 假 tools/on/get）验证：
 * - 8 个工具定义注册（list/get/create/update/set_pinned/delete + notes_task_set_status/report）；
 * - guard：宿主没装 approval seam、目标是 origin='user' 时拒绝删除，放行其余；
 * - 确认：改 / 删 origin='user' 便签由**工具自己在执行体里**发起「同意 / 拒绝」
 *   （与会话审批策略无关）；拒绝 / 取消 / 无人应答一律不执行（fail-closed）；
 *   新建、置顶、改自己建的便签一概不问；
 * - create 经工具层创建落 origin='agent'。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NotesService } from '../src/service.ts'
import type { TaskLease } from '../src/domain.ts'
import type { NoteId, NoteRecord } from '../src/types.ts'
import {
  installNotesTools,
  isNotesTaskTool,
  isNotesTool,
  isNotesWriteTool,
  notesDeleteGuard,
  notesTaskGuard,
  requestNoteConsent,
  NOTES_TOOL_PREFIX,
} from '../src/agent/tools.ts'

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
  userQuestions: boolean
  /** 假 userQuestions 服务给出的选择：[] = 关了不答。 */
  consentSelected: string[]
  /** 让 ask() 抛错（模拟提问通道坏掉）。 */
  consentThrows: boolean
  /** 记录每次 ask() 的问题（断言「问了几次、问了什么」）。 */
  consentCalls: Array<{ question: string; options: string[] }>
}

function makeHarness(): Harness {
  const ctx = new Context()
  const table = fakeTable<NoteRecord>()
  const leases = fakeTable<TaskLease>()
  const domain = {
    table: (name: string) => (name === 'notes' ? table : name === 'leases' ? leases : undefined),
  } as never
  const notes = new NotesService(ctx, { domain })
  const registered: FakeDefinition[] = []
  const guards: Harness['guards'] = []
  const preExecutes: Harness['preExecutes'] = []
  const state: { seam: boolean; selected: string[]; throws: boolean } = { seam: false, selected: ['允许一次'], throws: false }
  const consentCalls: Harness['consentCalls'] = []
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
    get: (key: string) => {
      if (key !== 'userQuestions' || !state.seam) return undefined
      return {
        // 与 approval.request() 不同：这一问没有任何策略门（策略 never 也照常问）。
        ask: async (req: { questions: Array<{ id: string; question: string; options?: Array<{ label: string }> }> }) => {
          if (state.throws) throw new Error('provider exploded')
          const q = req.questions[0]!
          consentCalls.push({ question: q.question, options: (q.options ?? []).map(o => o.label) })
          return { answers: [{ id: q.id, selected: [...state.selected] }] }
        },
      }
    },
  } as unknown as Context

  installNotesTools(fakeCtx)
  return {
    notes,
    table,
    ctx: fakeCtx,
    registered,
    guards,
    preExecutes,
    get userQuestions() { return state.seam },
    set userQuestions(v: boolean) { state.seam = v },
    get consentSelected() { return state.selected },
    set consentSelected(v: string[]) { state.selected = v },
    get consentThrows() { return state.throws },
    set consentThrows(v: boolean) { state.throws = v },
    consentCalls,
  }
}

/** 最小 exec 替身：guard 读 name / arguments / agent；确认流程还要 callId。 */
const execOf = (name: string, args: unknown, sessionId = 's1') =>
  ({
    name,
    arguments: args,
    callId: 'call-1',
    agent: { session: { id: sessionId } },
  }) as unknown as ToolExecution

describe('notes agent 工具注册', () => {
  it('注册 8 个 notes_* 工具（读 2 + 写 4 + 任务 2）', () => {
    const { registered } = makeHarness()
    const names = registered.map(d => d.name).sort()
    expect(names).toEqual([
      `${NOTES_TOOL_PREFIX}create`,
      `${NOTES_TOOL_PREFIX}delete`,
      `${NOTES_TOOL_PREFIX}get`,
      `${NOTES_TOOL_PREFIX}list`,
      `${NOTES_TOOL_PREFIX}set_pinned`,
      `${NOTES_TOOL_PREFIX}task_report`,
      `${NOTES_TOOL_PREFIX}task_set_status`,
      `${NOTES_TOOL_PREFIX}update`,
    ])
  })

  it('读工具放行、写工具需审批的判定函数', () => {
    expect(isNotesTool('notes_list')).toBe(true)
    expect(isNotesTool('notes_create')).toBe(true)
    expect(isNotesTool('notes_task_set_status')).toBe(true)
    expect(isNotesTool('other_tool')).toBe(false)
    expect(isNotesWriteTool('notes_list')).toBe(false)
    expect(isNotesWriteTool('notes_create')).toBe(true)
    expect(isNotesWriteTool('notes_delete')).toBe(true)
    // 任务工具不在写工具 ask 集合（pre-execute 直通，guard 兜底）
    expect(isNotesWriteTool('notes_task_set_status')).toBe(false)
    expect(isNotesWriteTool('notes_task_report')).toBe(false)
    expect(isNotesTaskTool('notes_task_set_status')).toBe(true)
    expect(isNotesTaskTool('notes_task_report')).toBe(true)
    expect(isNotesTaskTool('notes_update')).toBe(false)
  })
})

describe('notes_delete guard', () => {
  it('无 approval 渠道：拒绝删除 user 手写便签', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ title: 't', text: 'b' }) // origin 默认 user
    const reason = h.guards[0]?.(execOf('notes_delete', { note_id: note.id }))
    expect(reason).toMatch(/written by the user/)
  })

  it('有 approval seam：guard 不拦（授权交给工具内的确认）', async () => {
    const h = makeHarness()
    h.userQuestions = true
    const note = await h.notes.create({ title: 't', text: 'b' })
    expect(h.guards[0]?.(execOf('notes_delete', { note_id: note.id }))).toBeUndefined()
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

describe('改 / 删用户便签：由工具自己在执行体内弹确认', () => {
  /** 找到已注册工具的 execute。 */
  function tool(h: Harness, name: string): FakeDefinition {
    const def = h.registered.find(d => d.name === name)
    if (!def) throw new Error(`tool ${name} not registered`)
    return def
  }

  it('同意：改用户便签成功，问题里带便签标题与两个选项', async () => {
    const h = makeHarness()
    h.userQuestions = true
    const note = await h.notes.create({ title: '今天 18:00 下班', text: 'b' })
    const updated = await tool(h, 'notes_update').execute({ note_id: note.id, text: '改过了' }, execOf('notes_update', {}))
    expect((updated as NoteRecord).text).toBe('改过了')
    expect(h.consentCalls).toHaveLength(1)
    expect(h.consentCalls[0]!.question).toContain('今天 18:00 下班')
    expect(h.consentCalls[0]!.question).toContain('update your note')
    expect(h.consentCalls[0]!.options).toEqual(['允许一次', '不要'])
  })

  it('拒绝：改用户便签抛错，且一个字都没写进去', async () => {
    const h = makeHarness()
    h.userQuestions = true
    h.consentSelected = ['不要']
    const note = await h.notes.create({ title: 't', text: '原文' })
    await expect(tool(h, 'notes_update').execute({ note_id: note.id, text: '改过了' }, execOf('notes_update', {})))
      .rejects.toThrow(/not allowed/)
    expect(h.notes.list().find(n => n.id === note.id)?.text).toBe('原文')
  })

  it('关掉不答（没选任何选项）：同样不执行', async () => {
    const h = makeHarness()
    h.userQuestions = true
    h.consentSelected = []
    const note = await h.notes.create({ title: 't', text: '原文' })
    await expect(tool(h, 'notes_update').execute({ note_id: note.id, text: 'x' }, execOf('notes_update', {})))
      .rejects.toThrow(/not allowed/)
    expect(h.notes.list().find(n => n.id === note.id)?.text).toBe('原文')
  })

  it('提问通道抛错：不执行（fail-closed）', async () => {
    const h = makeHarness()
    h.userQuestions = true
    h.consentThrows = true
    const note = await h.notes.create({ title: 't', text: '原文' })
    await expect(tool(h, 'notes_update').execute({ note_id: note.id, text: 'x' }, execOf('notes_update', {})))
      .rejects.toThrow(/could not be shown/)
    expect(h.notes.list().find(n => n.id === note.id)?.text).toBe('原文')
  })

  it('删用户便签：同意才删掉', async () => {
    const h = makeHarness()
    h.userQuestions = true
    const note = await h.notes.create({ title: 't', text: 'b' })
    const res = await tool(h, 'notes_delete').execute({ note_id: note.id }, execOf('notes_delete', {}))
    expect(res).toEqual({ deleted: true, id: note.id })
    expect(h.consentCalls[0]!.question).toContain('delete your note')
  })

  it('删用户便签：拒绝则仍在', async () => {
    const h = makeHarness()
    h.userQuestions = true
    h.consentSelected = ['不要']
    const note = await h.notes.create({ title: 't', text: 'b' })
    await expect(tool(h, 'notes_delete').execute({ note_id: note.id }, execOf('notes_delete', {})))
      .rejects.toThrow(/not allowed/)
    expect(h.notes.list().find(n => n.id === note.id)).toBeDefined()
  })

  it('agent 自己的便签、置顶、新建：一概不问', async () => {
    const h = makeHarness()
    h.userQuestions = true
    const mine = await h.notes.create({ title: 'mine', text: 'b', origin: 'agent' })
    const theirs = await h.notes.create({ title: 'theirs', text: 'b' })
    await tool(h, 'notes_update').execute({ note_id: mine.id, text: 'x' }, execOf('notes_update', {}))
    await tool(h, 'notes_set_pinned').execute({ note_id: theirs.id, pinned: true }, execOf('notes_set_pinned', {}))
    await tool(h, 'notes_create').execute({ title: 'n', text: 'b' }, execOf('notes_create', {}))
    expect(h.consentCalls).toHaveLength(0)
  })

  it('便签不存在：不问，直接走 not found', async () => {
    const h = makeHarness()
    h.userQuestions = true
    const res = await tool(h, 'notes_delete').execute({ note_id: 'nope' }, execOf('notes_delete', {}))
    expect(res).toEqual({ deleted: false, id: 'nope' })
    expect(h.consentCalls).toHaveLength(0)
  })

  it('宿主没有提问通道：改 / 删都抛错且不执行（fail-closed）', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ title: 't', text: 'b' })
    await expect(tool(h, 'notes_update').execute({ note_id: note.id, text: 'x' }, execOf('notes_update', {})))
      .rejects.toThrow(/no way to ask you for consent/)
    await expect(tool(h, 'notes_delete').execute({ note_id: note.id }, execOf('notes_delete', {})))
      .rejects.toThrow(/no way to ask you for consent/)
    expect(h.notes.list().find(n => n.id === note.id)?.text).toBe('b')
  })

  it('requestNoteConsent：无 agent 也照问（与官方 ask 工具同形状，agent 可选）', async () => {
    const h = makeHarness()
    h.userQuestions = true
    const noAgent = { name: 'notes_delete', arguments: {}, callId: 'c' } as unknown as ToolExecution
    await expect(requestNoteConsent(h.ctx, noAgent, 'delete your note "x"')).resolves.toBeUndefined()
    expect(h.consentCalls).toHaveLength(1)
  })
})
describe('notes_task 工具：guard 与 execute', () => {
  /** 组装带会话身份的 exec（agent.id 即 SessionId，guard 据此匹配 lease.sessionId）。 */
  const taskExec = (name: string, args: unknown, sessionId?: string) =>
    ({ name, arguments: args, agent: sessionId !== undefined ? { id: sessionId } : undefined }) as unknown as ToolExecution

  it('无租约时被 guard 拒绝（中文原因文本）', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ text: 't', laneStatus: 'todo' })
    const reason = notesTaskGuard(h.ctx, taskExec('notes_task_set_status', { note_id: note.id }, 's1'))
    expect(reason).toMatch(/无有效执行租约/)
  })

  it('会话不符时被 guard 拒绝', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ text: 't', laneStatus: 'todo' })
    await h.notes.grantTaskLease(note.id, 's1')
    const reason = notesTaskGuard(h.ctx, taskExec('notes_task_set_status', { note_id: note.id }, 's2'))
    expect(reason).toMatch(/会话/)
  })

  it('有匹配租约时放行，set_status 置 lane.status=running', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ text: 't', laneStatus: 'todo' })
    await h.notes.grantTaskLease(note.id, 's1')
    expect(notesTaskGuard(h.ctx, taskExec('notes_task_set_status', { note_id: note.id }, 's1'))).toBeUndefined()
    const tool = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}task_set_status`)!
    const updated = await tool.execute({ note_id: note.id, status: 'running' }, {})
    expect((updated as NoteRecord).lane?.status).toBe('running')
  })

  it('report 收尾写 run 摘要 + 状态 done + 撤销租约（随后 set_status 被拒）', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ text: 't', laneStatus: 'todo' })
    await h.notes.grantTaskLease(note.id, 's1')
    expect(notesTaskGuard(h.ctx, taskExec('notes_task_report', { note_id: note.id }, 's1'))).toBeUndefined()
    const tool = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}task_report`)!
    const done = await tool.execute({ note_id: note.id, ok: true, summary: 'done it' }, {})
    expect((done as NoteRecord).lane).toMatchObject({ status: 'done', run: { ok: true, summary: 'done it' } })
    // lease 已撤销 → 第二次 set_status 被拒
    const reason = notesTaskGuard(h.ctx, taskExec('notes_task_set_status', { note_id: note.id }, 's1'))
    expect(reason).toMatch(/无有效执行租约/)
  })

  it('report ok=false 置 failed', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ text: 't', laneStatus: 'todo' })
    await h.notes.grantTaskLease(note.id, 's1')
    const tool = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}task_report`)!
    const failed = await tool.execute({ note_id: note.id, ok: false, summary: 'boom' }, {})
    expect((failed as NoteRecord).lane).toMatchObject({ status: 'failed', run: { ok: false, summary: 'boom' } })
  })

  it('set_status 置非 running（done/failed/todo/backlog）被拒：中文原因，且不动租约', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ text: 't', laneStatus: 'todo' })
    await h.notes.grantTaskLease(note.id, 's1')
    const tool = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}task_set_status`)!
    for (const status of ['done', 'failed', 'todo', 'backlog']) {
      await expect(tool.execute({ note_id: note.id, status }, {})).rejects.toThrow(/set_status 仅允许置为 running/)
    }
    // 拒绝发生在服务调用前，不得误撤销租约
    expect(h.notes.getTaskLease(note.id)).toBeDefined()
  })

  it('set_status(running) 在已 running 时为无害 no-op（不改 run 帧、不撤租约）', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ text: 't', laneStatus: 'todo' })
    await h.notes.grantTaskLease(note.id, 's1') // → running + run 帧
    const before = h.notes.list().find(n => n.id === note.id)!
    const tool = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}task_set_status`)!
    const updated = await tool.execute({ note_id: note.id, status: 'running' }, {})
    expect((updated as NoteRecord).lane).toEqual(before.lane)
    expect(h.notes.getTaskLease(note.id)).toBeDefined()
  })

  it('无 lane 便签被 guard 拒绝', async () => {
    const h = makeHarness()
    const note = await h.notes.create({ text: 't' }) // 无 laneStatus → 普通便签
    const reason = notesTaskGuard(h.ctx, taskExec('notes_task_report', { note_id: note.id }, 's1'))
    expect(reason).toMatch(/不是任务/)
  })

  it('guard 已注册到宿主（与 origin guard 同挂 tools.guard）', async () => {
    const h = makeHarness()
    expect(h.guards.length).toBeGreaterThanOrEqual(2)
    const note = await h.notes.create({ text: 't', laneStatus: 'todo' })
    const reason = h.guards[1]!(taskExec('notes_task_set_status', { note_id: note.id }, 's1'))
    expect(reason).toMatch(/无有效执行租约/)
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

describe('notes 读工具 lane / workspace 透出', () => {
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
  it('真实便签的字段全部被输出 schema 声明（漏声明 = harness 判非法输出，整次调用失败）', async () => {
    const h = makeHarness()
    // 用「带 lane + 带 schedule + 带 workspace」的任务便签：字段最全的形状。
    // schedule 必须在场：带日程的便签一旦漏声明，notes_list/notes_get/task_report
    // 会整次被判非法输出（本用例当初正因 fixture 无日程而漏掉这个字段）。
    const note = await h.notes.create({
      title: 't',
      text: 'b',
      laneStatus: 'todo',
      workspace: 'D:/ws',
      schedule: { enabled: true, mode: 'once', at: Date.now() + 60_000 },
    })
    // host 自有字段也要塞满：日程错误边界计数（setSchedule 直写）+ run 帧发起方（grant）。
    await h.notes.setSchedule(note.id, { ...note.schedule!, failureStreak: 2, runCount: 5 })
    await h.notes.grantTaskLease(note.id, 'sess-1')
    const value = h.notes.list().find(n => n.id === note.id)!
    const declaredOf = (short: string): Record<string, unknown> => {
      const def = h.registered.find(d => d.name === `${NOTES_TOOL_PREFIX}${short}`)!
      expect(def, short).toBeDefined()
      const schema = def.output.schema as { properties: Record<string, unknown> }
      // notes_list 的便签形状嵌在 notes.items 里，其余工具就是顶层。
      if (short === 'list') {
        const items = (schema.properties.notes as { items: { properties: Record<string, unknown> } }).items
        return items.properties
      }
      return schema.properties
    }
    // 嵌套形状同样受 additionalProperties:false 约束：各形态的日程字段都要被声明。
    const scheduled = [
      await h.notes.create({ text: 'b', laneStatus: 'todo', schedule: { enabled: true, mode: 'interval', everyMin: 30 } }),
      await h.notes.create({ text: 'b', laneStatus: 'todo', schedule: { enabled: true, mode: 'weekly', time: '09:30', weekdays: [1, 3] } }),
      await h.notes.create({ text: 'b', laneStatus: 'todo', schedule: { enabled: true, mode: 'monthly', time: '09:30', monthDay: 15 } }),
    ]
    const scheduleProps = (declaredOf('get').schedule as { properties: Record<string, unknown> }).properties
    for (const n of [value, ...scheduled]) {
      const keys = Object.keys(n.schedule ?? {})
      expect(keys.filter(k => !(k in scheduleProps)), `schedule(${n.schedule?.mode}) 未声明字段`).toEqual([])
    }
    // lane.run 的嵌套形状同样要声明（by = 发起方）。
    const laneProps = (declaredOf('get').lane as { properties: Record<string, unknown> }).properties
    const runProps = (laneProps.run as { properties: Record<string, unknown> }).properties
    expect(value.lane?.run?.by).toBeDefined()
    expect(Object.keys(value.lane?.run ?? {}).filter(k => !(k in runProps))).toEqual([])
    for (const short of ['list', 'get', 'create', 'update', 'set_pinned', 'task_set_status', 'task_report']) {
      const declared = declaredOf(short)
      const undeclared = Object.keys(value).filter(k => !(k in declared))
      expect(undeclared, `${short} 未声明字段`).toEqual([])
    }
  })
})