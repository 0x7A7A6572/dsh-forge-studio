/**
 * client apply 全链路测试：真实 cordis ctx + TypertRegistry + api-gateway remote
 * + connection stub + 最小 slots stub，跑我们 client/index.ts 的 apply。
 *
 * 回归目标：
 * 1. 唯一 UI 面是设置面板一级「记忆」分区 —— register 只收到一次 settings.section，
 *    id/label/order 正确，且 component 是函数（真实挂载路径在浏览器里）；
 * 2. inject 面给出的 memory 命名空间方法齐全（视图全靠它取数）；
 * 3. 没有多注册别的 slot（比如侧栏入口）。
 */

import { describe, expect, it, beforeAll, vi } from 'vitest'

// 宿主 UI 原语是浏览器包（lib 内含 .css module，Node 直接 import 会炸），本测试只
// 关心 slot 注册链路、不渲染任何组件，所以整包换成空壳。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const Stub = (): null => null
  return {
    Button: Stub,
    Input: Stub,
    Modal: Stub,
    Pill: Stub,
    IconArchiveOutline20: Stub,
    IconChecklistOutline14: Stub,
    IconCopyOutline16: Stub,
    IconDownloadOutline16: Stub,
    IconEditOutline16: Stub,
    IconLightOutline16: Stub,
    IconListPenOutline16: Stub,
    IconPlusOutline16: Stub,
    IconRefreshOutline16: Stub,
    IconTrashOutline16: Stub,
  }
})

import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { apply as applyMemoryClient } from '../src/client/index.ts'
import { memoryOf } from '../src/client/core/remote.ts'

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

function makeSlots(captured: Captured): {
  inject: (key: string, activate: () => unknown) => () => void
  register: (options: Record<string, unknown>, component: unknown) => () => void
} {
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

describe('client apply：记忆 = 设置面板一级分区', () => {
  it('注册一次 settings.section，带正确的导航身份与可用的 memory 注入面', async () => {
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

    applyMemoryClient(ctx)
    // 等嵌套 inject callback 完成（远程命名空间挂载 → 分区注册）。
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(captured.keys).toEqual(['settings.section'])
    expect(captured.registrations).toHaveLength(1)

    const { options, component } = captured.registrations[0]!
    expect(options.name).toBe('settings.section')
    expect(options.id).toBe('memory')
    expect(options.label).toBe('记忆')
    expect(options.order).toBe(20)
    expect(typeof component).toBe('function')

    // 注入面：视图取数用的 memory 远程命名空间，20 个端点齐全。
    const inject = options.inject as () => { memory: Record<string, unknown> }
    const memory = inject().memory
    const expected = [
      'list', 'getConfig', 'setConfig', 'getConflicts', 'stats', 'projects', 'exportText',
      'save', 'updateMemory', 'setArchived', 'removeMemory', 'reset', 'importText', 'tidy',
      'ingest', 'reingest', 'rawDocuments', 'getRawDocument', 'removeRawDocument', 'audits',
    ]
    for (const method of expected) {
      expect(typeof memory[method], 'missing method ' + method).toBe('function')
    }

    // memoryOf(ctx) 也能取到同一命名空间（每次访问返回新的服务代理，故比较能力
    // 而非身份；代理对象也不能交给 toBe —— matcher 的属性访问会穿透到 cordis
    // 服务代理上抛 "without inject"）。
    const viaCtx = memoryOf(ctx) as unknown as Record<string, unknown>
    for (const method of expected) {
      expect(typeof viaCtx[method], 'memoryOf missing ' + method).toBe('function')
    }
  })
})
