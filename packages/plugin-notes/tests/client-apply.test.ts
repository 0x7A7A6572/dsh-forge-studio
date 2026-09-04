/**
 * client apply 全链路测试：真实 cordis ctx + TypertRegistry + api-gateway remote
 * + connection stub + 最小 slots/settingsScope stub，运行我们 client/index.ts 的
 * apply。显示形式已对齐 dsh-task-board，改为 DOM 注入（侧栏入口行 + 中间列面板
 * 接管，见 core/sidebar-entry.ts / core/panel-mount.ts）；node 环境无 document，
 * 两个挂载函数 no-op，本测试只断言 apply 链路不抛错、notes 远程命名空间就绪。
 * 这是「入口/面板挂载路径不抛错」的回归防线（浏览器端可见性由手动验证）。
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { apply as applyNotesClient } from '../src/client/index.ts'
import { notesOf } from '../src/client/core/notes-remote.ts'

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

describe('client apply 全链路（DOM 挂载 no-op）', () => {
  it('apply 后 notes 远程命名空间就绪且无异常', async () => {
    const ctx = new Context()
    new TypertRegistry(ctx) // provides ctx.typert

    const connection = {
      rpc: {
        open: undefined,
        call: async () => ({ ok: true, value: { __stub: true } }),
      },
      start: () => ({ stop: () => {} }),
      generation: { getSnapshot: () => undefined },
      isLoopback: true,
      registerGenerationSource: () => () => {},
    }
    await ctx.plugin({ apply: () => ctx.provide('connection', connection) })
    gatewayApply(ctx) // installs ctx.remote

    // slots / settingsScope 仍被 client apply 的 inject 声明依赖（cordis 要求
    // 声明即注入）；DOM 挂载不再使用 slots，settingsScope 只在面板渲染时才读。
    const slots = {
      inject: () => () => {},
      register: () => () => {},
    }
    const scope = {
      getSnapshot: () => ({ value: undefined }),
      subscribe: () => () => {},
      define: () => () => {},
    }
    const settingsScope = { bind: () => scope }
    await ctx.plugin({ apply: () => ctx.provide('slots', slots) })
    await ctx.plugin({ apply: () => ctx.provide('settingsScope', settingsScope) })

    // 运行我们真实的 client apply（node 无 document，侧栏入口/中间列面板挂载 no-op）
    applyNotesClient(ctx)
    // 等嵌套 inject callback 完成（外层挂载 + 内层面板/入口挂载）
    await new Promise((r) => setTimeout(r, 500))

    // notes 远程命名空间就绪，方法齐全。
    const notes = notesOf(ctx)
    expect(notes).toBeDefined()
    for (const m of ['list', 'create', 'update', 'setPinned', 'delete']) {
      expect(typeof (notes as unknown as Record<string, unknown>)[m]).toBe('function')
    }

    await ctx.fiber.dispose()
  })
})
