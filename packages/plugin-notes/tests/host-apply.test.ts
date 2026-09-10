/**
 * host apply 真实入口回归测试（postmortem #0001 教训：测试真实加载路径）。
 *
 * 复现 bug：plugin-notes 的 host apply 曾 `return ctx.inject(['storageDomain'], …)`。
 * cordis 把 apply 的 thenable 返回值当作「effect/disposer」收集，fiber 收束后触发
 * `safeCollect(fiber)` → `TypeError("Invalid effect")`，导致整个插件（NotesService、
 * 设置、notes_* 工具）都无法加载。此处用真实 cordis Context + 假服务，走
 * `ctx.plugin(namespace)`（与 loader 的 `registry.plugin(…)+fiber.await()` 同路径）
 * 验证 apply 不再抛错，且 ctx.notes 与 notes_* 工具确实注册。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import * as plugin from '../src/index.ts'
import { NOTES_TOOL_PREFIX } from '../src/agent/tools.ts'
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

/** 提供一个假 storageDomain：open() 返回带 notes/leases 两张表的假域。 */
async function provideStorageDomain(ctx: Context): Promise<void> {
  const domain = {
    table: (name: string) => (name === 'notes' ? fakeTable<NoteRecord>() : name === 'leases' ? fakeTable<never>() : undefined),
    close: async () => {},
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('storageDomain', { open: async () => domain } as never) })
}

async function provideSettings(ctx: Context): Promise<void> {
  await ctx.plugin({ apply: (c: Context) => c.provide('settings', { register: () => {} } as never) })
}

async function provideTools(ctx: Context, registered: string[]): Promise<void> {
  const fakeTools = {
    register: (def: { name: string }) => { registered.push(def.name) },
    guard: () => {},
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('tools', fakeTools as never) })
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

describe('host apply（真实 cordis 加载路径）', () => {
  it('apply 不再抛 "Invalid effect"，且注册 ctx.notes + 8 个 notes_* 工具', async () => {
    const ctx = new Context()
    const registered: string[] = []
    await provideStorageDomain(ctx)
    await provideSettings(ctx)
    await provideTools(ctx, registered)

    // 走真实入口：ctx.plugin(namespace) → resolve(apply) + Inject.resolve(inject)，
    // 与 loader 的 registry.plugin(…)+fiber.await() 同一条 cordis 路径。
    const fiber = ctx.plugin(plugin)
    await fiber // 修复前这里抛 TypeError("Invalid effect")

    expect(ctx.notes).toBeDefined()
    await tick() // 让 tools 的 inject fiber 收束
    expect([...registered].sort()).toEqual(TOOL_NAMES)

    await ctx.fiber.dispose()
  })
})
