/**
 * agent 桥挂载时序集成测试（回归防线）。
 *
 * 复现 bug：宿主装配是 service-availability 驱动的（行序不承载加载语义），
 * plugin-notes 只依赖 storageDomain，tools/systemPrompt 服务可能晚于插件激活。
 * 旧实现用 apply 时一次性 ctx.get('tools') 判存 → 服务未就绪时永久漏挂、无重试
 * （web GUI 会话看不到 notes_* 工具）。新实现用 ctx.inject 声明依赖，cordis 在
 * 服务注册（provide→notify）时唤醒等待中的 fiber。
 *
 * 桥状态契约（agent/bridge-state.ts）：waiting → installed | failed，单向迁移。
 * - 工具注册成功 → 桥 installed；失败 → failed（含 reason），只降级不抛；
 * - 引用提示（note:// mention 引导）只在 installed 之后挂载——tools 失败时
 *   agent 不会被空头告知“存在 notes_* 工具却调不到”（unknown tool bug）。
 *
 * 用真实 cordis Context + 假 tools/systemPrompt 服务，验证：
 * - tools 晚到 / 已就绪 / 永不提供（纯 UI 宿主，不注册也不抛错、ctx 可卸载）；
 * - tools 注册抛错 → 桥 failed、引用提示不挂载；
 * - reference 门控：tools 成功后才挂，且与 systemPrompt 的到达次序无关。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NotesService } from '../src/service.ts'
import {
  installNotesAgentBridgeWhenReady,
  installNotesReferencePromptWhenReady,
  installNotesToolsWhenReady,
} from '../src/index.ts'
import { NOTES_TOOL_PREFIX } from '../src/agent/tools.ts'
import { NOTES_REFERENCE_SECTION } from '../src/agent/reference.ts'
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

/** 造一个挂好 ctx.notes 的真 cordis ctx（NotesService 直接 new，同 service.test）。 */
function makeNotesContext(): Context {
  const ctx = new Context()
  const table = fakeTable()
  const domain = {
    table: (name: string) => (name === 'notes' ? table : undefined),
    close: async () => {},
  } as never
  new NotesService(ctx, { domain })
  return ctx
}

/** 在 ctx 上注册一个假 tools 服务（只记录 register/guard 调用）。 */
async function provideTools(ctx: Context, registered: string[]): Promise<void> {
  const fakeTools = {
    register: (def: { name: string }) => { registered.push(def.name) },
    guard: () => {},
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('tools', fakeTools as never) })
}

/** 在 ctx 上注册一个“坏 tools”：register 即抛错，模拟宿主 tools API 故障。 */
async function provideBrokenTools(ctx: Context): Promise<void> {
  const brokenTools = {
    register: () => { throw new Error('boom: register rejected') },
    guard: () => {},
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('tools', brokenTools as never) })
}

/** 在 ctx 上注册一个假 systemPrompt 服务（记录 section 调用）。 */
async function provideSystemPrompt(ctx: Context, sections: string[]): Promise<void> {
  const fakePrompt = {
    section: (s: { name: string }) => { sections.push(s.name) },
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('systemPrompt', fakePrompt as never) })
}

const tick = () => new Promise((r) => setTimeout(r, 20))

const TOOL_NAMES = [
  `${NOTES_TOOL_PREFIX}list`,
  `${NOTES_TOOL_PREFIX}get`,
  `${NOTES_TOOL_PREFIX}create`,
  `${NOTES_TOOL_PREFIX}update`,
  `${NOTES_TOOL_PREFIX}set_pinned`,
  `${NOTES_TOOL_PREFIX}delete`,
  `${NOTES_TOOL_PREFIX}task_set_status`,
  `${NOTES_TOOL_PREFIX}task_report`,
].sort()

describe('agent 桥挂载时序（tools 晚于插件就绪）', () => {
  it('when-ready 先跑、tools 后注册 → 工具挂上、桥收束 installed', async () => {
    const ctx = makeNotesContext()
    const registered: string[] = []
    expect(ctx.notes.getAgentBridgeState()).toEqual({ status: 'waiting' }) // 默认 waiting
    const install = installNotesToolsWhenReady(ctx) // tools 尚未提供
    await tick()
    expect(registered).toEqual([]) // 未注册说明确实在等待
    await provideTools(ctx, registered)
    const settled = await install
    expect(settled).toEqual({ status: 'installed', at: expect.any(Number) })
    expect([...registered].sort()).toEqual(TOOL_NAMES)
    expect(ctx.notes.getAgentBridgeState().status).toBe('installed') // 状态已推进
    await ctx.fiber.dispose()
  })

  it('tools 已就绪、when-ready 后跑 → 立即挂上（不丢旧路径）', async () => {
    const ctx = makeNotesContext()
    const registered: string[] = []
    await provideTools(ctx, registered)
    const install = installNotesToolsWhenReady(ctx)
    const settled = await install
    expect(settled.status).toBe('installed')
    expect([...registered].sort()).toEqual(TOOL_NAMES)
    expect(ctx.notes.getAgentBridgeState().status).toBe('installed')
    await ctx.fiber.dispose()
  })

  it('永不提供 tools（纯 UI 宿主）→ 不注册、桥保持 waiting、ctx 可卸载', async () => {
    const ctx = makeNotesContext()
    installNotesToolsWhenReady(ctx)
    await tick()
    expect(ctx.notes.getAgentBridgeState()).toEqual({ status: 'waiting' })
    await ctx.fiber.dispose() // 等待中的 fiber 随 ctx 清理，不应挂死
  })

  it('tools 注册抛错 → 桥收束 failed（含 reason）、不抛到插件层', async () => {
    const ctx = makeNotesContext()
    await provideBrokenTools(ctx)
    const install = installNotesToolsWhenReady(ctx)
    const settled = await install
    expect(settled.status).toBe('failed')
    if (settled.status === 'failed') expect(settled.reason).toBe('boom: register rejected')
    expect(ctx.notes.getAgentBridgeState().status).toBe('failed')
    await ctx.fiber.dispose()
  })
})

describe('agent 桥挂载时序（reference 门控于 tools 成功）', () => {
  it('tools 与 systemPrompt 都晚到 → tools 成功后引用分区才挂上', async () => {
    const ctx = makeNotesContext()
    const registered: string[] = []
    const sections: string[] = []
    const install = installNotesToolsWhenReady(ctx)
    installNotesReferencePromptWhenReady(ctx, install)
    await provideTools(ctx, registered)
    await install
    await tick()
    expect(sections).toEqual([]) // 工具已就绪但 systemPrompt 未到 → 仍未挂
    await provideSystemPrompt(ctx, sections)
    await tick()
    expect(sections).toEqual([NOTES_REFERENCE_SECTION]) // 门控通过 + systemPrompt 就绪 → 挂
    await ctx.fiber.dispose()
  })

  it('systemPrompt 已就绪、tools 后到 → 引用分区随后挂上', async () => {
    const ctx = makeNotesContext()
    const registered: string[] = []
    const sections: string[] = []
    await provideSystemPrompt(ctx, sections)
    const install = installNotesToolsWhenReady(ctx)
    installNotesReferencePromptWhenReady(ctx, install)
    await tick()
    expect(sections).toEqual([])
    await provideTools(ctx, registered)
    await install
    await tick()
    expect(sections).toEqual([NOTES_REFERENCE_SECTION])
    await ctx.fiber.dispose()
  })

  it('tools 注册失败 → 即使 systemPrompt 就绪也不挂引用提示', async () => {
    const ctx = makeNotesContext()
    const sections: string[] = []
    await provideSystemPrompt(ctx, sections)
    await provideBrokenTools(ctx)
    const install = installNotesToolsWhenReady(ctx)
    installNotesReferencePromptWhenReady(ctx, install)
    await tick()
    expect(sections).toEqual([])
    expect(ctx.notes.getAgentBridgeState().status).toBe('failed')
    await ctx.fiber.dispose()
  })

  it('永不提供 tools → 引用提示永不挂载（不再空头告知 notes_* 存在）', async () => {
    const ctx = makeNotesContext()
    const sections: string[] = []
    const install = installNotesToolsWhenReady(ctx)
    installNotesReferencePromptWhenReady(ctx, install)
    await provideSystemPrompt(ctx, sections)
    await tick()
    expect(sections).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('installNotesAgentBridgeWhenReady（apply 使用的协调器）', () => {
  it('tools + systemPrompt 就绪 → 工具注册 + 引用挂载 + 桥 installed 全链路', async () => {
    const ctx = makeNotesContext()
    const registered: string[] = []
    const sections: string[] = []
    installNotesAgentBridgeWhenReady(ctx)
    await provideTools(ctx, registered)
    await provideSystemPrompt(ctx, sections)
    await tick()
    expect([...registered].sort()).toEqual(TOOL_NAMES)
    expect(sections).toEqual([NOTES_REFERENCE_SECTION])
    expect(ctx.notes.getAgentBridgeState().status).toBe('installed')
    await ctx.fiber.dispose()
  })
})
