/**
 * client $mount 全流程测试：复刻浏览器端 client apply —— cordis ctx + TypertRegistry
 * + connection stub + api-gateway client apply → ctx.remote.$mount(notesRemoteContribution)
 * → ctx.remote.notes 命名空间可用、方法齐全。
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { notesRemoteContribution, notesOf } from '../src/client/notes-remote.ts'

/** api-gateway/client 是浏览器 bundle：模拟 window.__ModuleLoader__ 截获注册，再跑 factory。 */
let gatewayApply: (ctx: Context) => void

beforeAll(async () => {
  let registration: { factory: (require: (spec: string) => unknown) => unknown } | undefined
  ;(globalThis as unknown as { window: unknown }).window = {
    __ModuleLoader__: {
      load: (reg: { factory: (require: (spec: string) => unknown) => unknown }) => {
        registration = reg
      },
    },
  }
  await import('@deepseek-ai/dsh-api-gateway/client')
  if (registration === undefined) throw new Error('api-gateway client did not register')
  const require = createRequire(import.meta.url)
  const exports = registration.factory(require) as { apply: (ctx: Context) => void }
  gatewayApply = exports.apply
})

describe('client $mount 全流程（api-gateway 原版）', () => {
  it('$mount 成功且 ctx.remote.notes 可用、方法齐全、可发起调用', async () => {
    const ctx = new Context()
    new TypertRegistry(ctx) // provides ctx.typert

    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const connection = {
      rpc: {
        open: undefined,
        call: async (_path: string, endpoint: string, payload: unknown) => {
          calls.push({ endpoint, payload })
          return { ok: true, value: { __stub: true } }
        },
      },
      start: () => ({ stop: () => {} }),
      generation: { getSnapshot: () => undefined },
      isLoopback: true,
      registerGenerationSource: () => () => {},
    }
    await ctx.plugin({ apply: () => ctx.provide('connection', connection) })
    const got = ctx.get('connection')
    if (got === undefined) throw new Error('connection stub did not provide')

    gatewayApply(ctx) // installs ctx.remote (ClientRemoteService)

    const dispose = await ctx.remote.$mount(notesRemoteContribution)
    const notes = notesOf(ctx)
    expect(notes).toBeDefined()
    for (const m of ['list', 'create', 'update', 'setPinned', 'delete']) {
      expect(typeof (notes as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    const res = await notes.list()
    expect(res).toEqual({ ok: true, value: { __stub: true } })
    expect(calls[0]!.endpoint).toBe('notes/list')
    expect(calls[0]!.payload).toEqual({ args: {} })

    await dispose()
    await ctx.fiber.dispose()
  })
})
