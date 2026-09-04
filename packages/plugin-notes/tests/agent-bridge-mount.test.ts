/**
 * agent 桥挂载时序集成测试（回归防线）。
 *
 * 复现 bug：宿主装配是 service-availability 驱动的（行序不承载加载语义），
 * plugin-notes 只依赖 storageDomain，tools/systemPrompt 服务可能晚于插件激活。
 * 旧实现用 apply 时一次性 ctx.get('tools') 判存 → 服务未就绪时永久漏挂、无重试
 * （web GUI 会话看不到 notes_* 工具）。新实现用 ctx.inject 声明依赖，cordis 在
 * 服务注册（provide→notify）时唤醒等待中的 fiber。
 *
 * 用真实 cordis Context + 假 tools/systemPrompt 服务，验证三种次序：
 * - 晚到：when-ready 先跑、服务后注册 → 仍挂上；
 * - 已就绪：服务先注册、when-ready 后跑 → 立即挂上；
 * - 永不提供：纯 UI 宿主不注册也不抛错，ctx 可正常卸载。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NotesService } from '../src/service.ts'
import { installNotesReferencePromptWhenReady, installNotesToolsWhenReady } from '../src/index.ts'
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
  it('when-ready 先跑、tools 后注册 → 工具仍挂上', async () => {
    const ctx = makeNotesContext()
    const registered: string[] = []
    installNotesToolsWhenReady(ctx) // tools 尚未提供
    await tick()
    expect(registered).toEqual([]) // 未注册说明确实在等待
    await provideTools(ctx, registered)
    await tick()
    expect([...registered].sort()).toEqual(TOOL_NAMES)
    await ctx.fiber.dispose()
  })

  it('tools 已就绪、when-ready 后跑 → 立即挂上（不丢旧路径）', async () => {
    const ctx = makeNotesContext()
    const registered: string[] = []
    await provideTools(ctx, registered)
    installNotesToolsWhenReady(ctx)
    await tick()
    expect([...registered].sort()).toEqual(TOOL_NAMES)
    await ctx.fiber.dispose()
  })

  it('永不提供 tools（纯 UI 宿主）→ 不注册、不抛错、ctx 可卸载', async () => {
    const ctx = makeNotesContext()
    installNotesToolsWhenReady(ctx)
    await tick()
    await ctx.fiber.dispose() // 等待中的 fiber 随 ctx 清理，不应挂死
  })
})

describe('agent 桥挂载时序（systemPrompt 晚于插件就绪）', () => {
  it('when-ready 先跑、systemPrompt 后注册 → 引用分区仍挂上', async () => {
    const ctx = makeNotesContext()
    const sections: string[] = []
    installNotesReferencePromptWhenReady(ctx)
    await tick()
    expect(sections).toEqual([])
    await provideSystemPrompt(ctx, sections)
    await tick()
    expect(sections).toEqual([NOTES_REFERENCE_SECTION])
    await ctx.fiber.dispose()
  })

  it('systemPrompt 已就绪 → 立即挂上', async () => {
    const ctx = makeNotesContext()
    const sections: string[] = []
    await provideSystemPrompt(ctx, sections)
    installNotesReferencePromptWhenReady(ctx)
    await tick()
    expect(sections).toEqual([NOTES_REFERENCE_SECTION])
    await ctx.fiber.dispose()
  })
})
