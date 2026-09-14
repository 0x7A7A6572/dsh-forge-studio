/**
 * client apply 全链路测试：真实 cordis ctx + TypertRegistry + api-gateway remote
 * + connection stub + 最小 slots stub，跑我们 client/index.ts 的 apply。
 *
 * 回归目标（工作报告入口改造后）：
 * 1. 唯一 UI 面是设置面板一级分区 —— register 只收到一次 settings.section，
 *    id/label/order 正确，且 component 是函数（真实挂载路径在浏览器里）；
 * 2. 不再有侧栏入口行 / 中间列接管（旧路径已删除，node 无 document 也无处注入）；
 * 3. inject 面给出的 dailyLog 命名空间方法齐全（视图全靠它取数）。
 */

import { describe, expect, it, beforeAll, vi } from 'vitest'

// 宿主 UI 原语是浏览器包（lib 内含 .css module，Node 直接 import 会炸），本测试只
// 关心 slot 注册链路、不渲染任何组件，所以整包换成空壳 —— 也免去为它配 vitest 转译。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const Stub = (): null => null
  const Icon = (): null => null
  return {
    Button: Stub, Input: Stub, MarkdownText: Stub, Modal: Stub, Pill: Stub,
    IconBrowseOutline16: Icon, IconCheckOutline14: Icon, IconDownloadOutline16: Icon,
    IconEditOutline16: Icon, IconLightOutline16: Icon, IconListPenOutline16: Icon,
    IconPlusOutline16: Icon, IconSendOutline14: Icon,
    IconTrashOutline16: Icon,
  }
})
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { apply as applyDailyLogClient } from '../src/client/index.ts'
import { dailyLogOf } from '../src/client/core/remote.ts'

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

/** 捕获 apply 期间的 slot 注入与注册，替代真实 slots 服务。 */
interface Captured {
  keys: string[]
  registrations: { options: Record<string, unknown>; component: unknown }[]
}

function makeSlots(captured: Captured): { inject: (key: string, activate: () => unknown) => () => void; register: (options: Record<string, unknown>, component: unknown) => () => void } {
  return {
    inject: (key, activate) => {
      captured.keys.push(key)
      activate()
      return () => {}
    },
    register: (options, component) => {
      captured.registrations.push({ options, component })
      return () => {}
    },
  }
}

describe('client apply：工作报告 = 设置面板一级分区', () => {
  it('注册一次 settings.section，带正确的导航身份与可用的 dailyLog 注入面', async () => {
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

    const captured: Captured = { keys: [], registrations: [] }
    const slots = makeSlots(captured)
    await ctx.plugin({ apply: () => ctx.provide('slots', slots) })

    applyDailyLogClient(ctx)
    // 等嵌套 inject callback 完成（远程命名空间挂载 → 分区注册）。
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(captured.keys).toEqual(['settings.section'])
    expect(captured.registrations).toHaveLength(1)

    const { options, component } = captured.registrations[0]!
    expect(options.name).toBe('settings.section')
    expect(options.id).toBe('daily-log')
    expect(options.label).toBe('工作报告')
    expect(options.order).toBe(30)
    expect(typeof component).toBe('function')

    // 注入面：视图取数用的 dailyLog 远程命名空间。
    const inject = options.inject as (() => { dailyLog: unknown }) | undefined
    expect(typeof inject).toBe('function')
    const face = inject!()
    expect(face.dailyLog).toBeDefined()
    for (const method of ['listSources', 'listReports', 'listTemplates', 'addSource', 'exportReport']) {
      expect(typeof (face.dailyLog as Record<string, unknown>)[method]).toBe('function')
    }

    // ctx.remote.dailyLog 与注入面同源（同一个已挂载命名空间；直接比对象会踩
    // cordis 可追踪代理的未知属性读取，这里逐方法比对形态）。
    for (const method of ['listSources', 'listReports', 'listTemplates']) {
      expect(typeof (dailyLogOf(ctx) as unknown as Record<string, unknown>)[method]).toBe('function')
    }

    await ctx.fiber.dispose()
  })

  it('不再注入侧栏入口行 / 中间列接管面板的根节点', async () => {
    const ctx = new Context()
    new TypertRegistry(ctx)
    const connection = {
      rpc: { open: undefined, call: async () => ({ ok: true, value: {} }) },
      start: () => ({ stop: () => {} }),
      generation: { getSnapshot: () => undefined },
      isLoopback: true,
      registerGenerationSource: () => () => {},
    }
    await ctx.plugin({ apply: () => ctx.provide('connection', connection) })
    gatewayApply(ctx)
    const captured: Captured = { keys: [], registrations: [] }
    await ctx.plugin({ apply: () => ctx.provide('slots', makeSlots(captured)) })

    applyDailyLogClient(ctx)
    await new Promise((resolve) => setTimeout(resolve, 200))

    // slots 只被用来注册设置分区：没有侧栏入口行的 DOM 注入路径（旧实现会在
    // 挂载时读 document 并插入 [data-dsh-dailylog-entry]）。
    expect(captured.keys).not.toContain('sidebar.footer.action')
    expect(typeof document).toBe('undefined')

    await ctx.fiber.dispose()
  })
})
