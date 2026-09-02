/**
 * client apply 全链路测试：真实 cordis ctx + TypertRegistry + api-gateway remote
 * + connection stub + 最小 slots/settingsScope stub，运行我们 client/index.ts 的
 * apply，断言三个 slot（入口/浮层/设置卡片）都完成注册、且过程不抛错。
 * 这是「入口按钮在浏览器不出现」问题的回归防线。
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { apply as applyGateway } from '@deepseek-ai/dsh-api-gateway/client'
import { apply as applyNotesClient } from '../src/client/index.ts'

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

describe('client apply 全链路（slots 注册）', () => {
  it('apply 后三个 slot 全部完成注册且无异常', async () => {
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

    // slots stub：记录 inject + register
    const registrations: Array<{ options: unknown; component: unknown }> = []
    const slotInjects: string[] = []
    const slots = {
      inject: (name: string, fn: () => unknown) => {
        slotInjects.push(name)
        const result = fn()
        if (typeof result === 'function') result()
        return () => {}
      },
      register: (options: unknown, component: unknown) => {
        registrations.push({ options, component })
        return () => {}
      },
    }
    const scope = {
      getSnapshot: () => ({ value: undefined }),
      subscribe: () => () => {},
      define: () => () => {},
    }
    const settingsScope = { bind: () => scope }
    await ctx.plugin({ apply: () => ctx.provide('slots', slots) })
    await ctx.plugin({ apply: () => ctx.provide('settingsScope', settingsScope) })

    // 运行我们真实的 client apply
    applyNotesClient(ctx)
    // 等嵌套 inject callback 完成（外层挂载 + 内层注册）
    await new Promise((r) => setTimeout(r, 500))

    expect(slotInjects.sort()).toEqual(['settings.plugin.item', 'shell.overlay', 'sidebar.footer.action'])
    const byName = new Map(registrations.map((r) => [(r.options as { name: string }).name, r.options]))
    expect((byName.get('sidebar.footer.action') as { id?: string }).id).toBe('notes-board')
    expect((byName.get('shell.overlay') as { id?: string }).id).toBe('notes-board')
    expect((byName.get('settings.plugin.item') as { key?: string }).key).toBe('forge-studio-notes')

    await ctx.fiber.dispose()
  })
})
