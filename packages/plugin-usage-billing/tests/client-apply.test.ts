import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { ENTRY_SLOT_ID, OVERLAY_SLOT_ID, SETTINGS_SECTION_ID } from '../src/client/index.ts'

/**
 * 极简 slots 假实现：记录 inject/register，并**对齐真槽的两条行为**（否则用例会假绿）：
 * - `register` 对同一 `(slot, id, priority)` 抛错（真 list-slot 会抛）；
 * - `inject` 把回调返回的 disposer 收集起来（真槽通过调用 fiber 回收）。
 */
function fakeCtx() {
  const registered: Array<{
    slot: string
    id: string
    order?: number
    inject: () => Record<string, unknown>
  }> = []
  const injected: string[] = []
  const disposers: Array<() => void> = []
  const live = new Set<string>()
  const keyOf = (slot: string, id: string, order?: number): string => `${slot}#${id}@${order ?? ''}`
  const ctx = {
    effect: (fn: () => (() => void) | void) => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    inject: (deps: string[], cb: (c: unknown) => void) => { void deps; cb(ctx) },
    logger: { warn: vi.fn(), error: vi.fn() },
    slots: {
      inject: (slot: string, cb: () => (() => void) | void) => {
        injected.push(slot)
        const d = cb()
        if (typeof d === 'function') disposers.push(d)
      },
      register: (
        spec: { name: string; id: string; order?: number; inject?: () => Record<string, unknown> },
        _component: unknown,
      ) => {
        const key = keyOf(spec.name, spec.id, spec.order)
        if (live.has(key)) throw new Error(`duplicate slot registration: ${key}`)
        live.add(key)
        registered.push({
          slot: spec.name, id: spec.id, order: spec.order, inject: spec.inject ?? (() => ({})),
        })
        return () => {
          live.delete(key)
          const i = registered.findIndex((r) => keyOf(r.slot, r.id, r.order) === key)
          if (i >= 0) registered.splice(i, 1)
        }
      },
    },
    remote: { $mount: async () => async () => {} },
    settingsScope: { bind: () => ({ get: () => ({}), watch: () => () => {} }) },
  }
  return { ctx, registered, injected, disposers }
}

describe('client apply', () => {
  it('注册入口卡与浮层（id 必须自用，不能占用参考插件的 usage-billing）', () => {
    const { ctx, registered } = fakeCtx()
    apply(ctx as never)
    const ids = registered.map((r) => `${r.slot}#${r.id}`)
    expect(ids).toContain(`sidebar.footer.action#${ENTRY_SLOT_ID}`)
    expect(ids).toContain(`shell.overlay#${OVERLAY_SLOT_ID}`)
    expect(ids).toContain(`settings.section#${SETTINGS_SECTION_ID}`)
    // 全部 client 侧槽位 id 都带 `zzerx-` 前缀；无前缀的 `usage-billing` 是参考插件的 id。
    for (const r of registered) {
      expect(r.id).not.toBe('usage-billing')
      expect(r.id.startsWith('zzerx-')).toBe(true)
    }
  })

  it('用声明感知的 slots.inject（不假设 slot 已存在）', () => {
    const { ctx, injected } = fakeCtx()
    apply(ctx as never)
    expect(injected).toContain('sidebar.footer.action')
    expect(injected).toContain('shell.overlay')
    expect(injected).toContain('settings.section')
  })

  it('重复 apply 前必须先卸载：假 register 与真槽同样拒绝重复，disposer 真的解注册', () => {
    const h = fakeCtx()
    apply(h.ctx as never)
    expect(h.registered).toHaveLength(3)
    // 真槽对同一 (slot, id, priority) 会抛 —— 这里同样，证明「重复 apply 不抛」不是靠假实现宽容。
    expect(() => apply(h.ctx as never)).toThrow(/duplicate slot registration/)
    // fiber stop：收集到的 disposer 必须真的把注册收回。
    // **不断言精确条数**：jsdom 环境下 ensureUsageBillingStyle 还会经 ctx.effect 挂一个样式
    // disposer（本文件无 document 时为 0），条数随环境变化。这里钉的是行为本身。
    expect(h.disposers.length).toBeGreaterThanOrEqual(3)
    for (const d of h.disposers) d()
    expect(h.registered).toHaveLength(0)
    // 卸干净后再次 apply 不再抛：上一轮确实被收回，而不是被假实现忽略。
    expect(() => apply(h.ctx as never)).not.toThrow()
    expect(h.registered).toHaveLength(3)
  })

  it('store 按 fiber 创建并与入口卡 / 浮层共享（不是模块级单例）', () => {
    const a = fakeCtx()
    apply(a.ctx as never)
    const first = a.registered.map((r) => r.inject().store)
    expect(first[0]).toBeDefined()
    // 入口卡点击只改 store 的 open，浮层读同一份状态才能跟着开合。
    expect(first[0]).toBe(first[1])

    const b = fakeCtx()
    apply(b.ctx as never)
    const second = b.registered.map((r) => r.inject().store)
    // 重新 apply 得到新的 store：不继承上一轮的 open/tab/range。
    expect(second[0]).not.toBe(first[0])
    expect((second[0] as { getSnapshot: () => { open: boolean } }).getSnapshot().open).toBe(false)
  })
})

/**
 * `remote` 面**按 fiber 声明**解析 —— 这正是真浏览器里「三个槽位注册成功、渲染即崩」的原因，
 * 而上面那个 `fakeCtx`（inject 直接同步回调、`remote` 上根本没有面）把这个差别抹平了，
 * 于是旧用例在插件已经崩掉的情况下依然全绿。本假实现按真运行时的规则建模：
 *
 * - 真运行时：api-gateway 把每个命名空间注册成**独立服务名** `remote.<namespace>`
 *   （`remoteServiceKey`），cordis reflect 只在 `fiber.store` 里按名查（`impl = fiber.store[prop]`），
 *   查不到就抛 `cannot get property "<name>" without inject`；而那个 store 由该 fiber 自己的
 *   `inject` 名单填充。所以「读面」必须发生在声明过 `remote.usageBilling` 的 ctx 上。
 * - 本实现：每个 ctx 自带声明清单，读清单外的服务**当场抛**逐字相同的错误；
 *   `inject(deps, cb)` 建子 ctx（清单 = deps），deps 里含尚未出现的面时**挂起**，
 *   面出现后再激活 —— 真 cordis 正是靠这个把「面没到」变成「回调不跑」，
 *   siblings 也就是靠它免掉 `await` 排队的。`$mount` 解析（下一个微任务）之后面才出现。
 */
function fakeFaceScopedCtx() {
  const mounted = { value: false }
  const face = { tag: 'usageBilling-face' }
  /** 每次读服务都记账：谁读的、那一刻声明了没有（未声明的会当场抛，这里留证据）。 */
  const serviceReads: Array<{ name: string; from: string; declared: boolean }> = []
  /** 读 `remote.usageBilling` 的每一次尝试。 */
  const faceReads: Array<{ from: string; declared: boolean }> = []
  const registered: Array<{
    slot: string
    id: string
    order?: number
    inject: () => Record<string, unknown>
  }> = []
  const disposers: Array<() => void> = []
  const live = new Set<string>()
  const parked: Array<{ deps: string[]; activate: () => void }> = []
  const keyOf = (slot: string, id: string, order?: number): string => `${slot}#${id}@${order ?? ''}`
  // 只有面是「可能不存在」的那种服务；slots / remote / settingsScope 由宿主先备好。
  const available = (name: string): boolean => name === 'remote.usageBilling' ? mounted.value : true

  const slots = {
    inject: (slot: string, cb: () => (() => void) | void) => {
      const d = cb()
      if (typeof d === 'function') disposers.push(d)
    },
    register: (
      spec: { name: string; id: string; order?: number; inject?: () => Record<string, unknown> },
      _component: unknown,
    ) => {
      const key = keyOf(spec.name, spec.id, spec.order)
      if (live.has(key)) throw new Error(`duplicate slot registration: ${key}`)
      live.add(key)
      registered.push({
        slot: spec.name, id: spec.id, order: spec.order, inject: spec.inject ?? (() => ({})),
      })
      return () => {
        live.delete(key)
        const i = registered.findIndex((r) => keyOf(r.slot, r.id, r.order) === key)
        if (i >= 0) registered.splice(i, 1)
      }
    },
  }

  const flush = (): void => {
    for (const p of [...parked]) {
      if (!p.deps.every(available)) continue
      parked.splice(parked.indexOf(p), 1)
      p.activate()
    }
  }

  const make = (label: string, declared: readonly string[]): Record<string, unknown> => {
    const decl = new Set(declared)
    const read = (name: string): void => {
      const ok = decl.has(name)
      serviceReads.push({ name, from: label, declared: ok })
      if (!ok) throw new Error(`cannot get property "${name}" without inject`)
    }
    const ctx: Record<string, unknown> = {
      __label: label,
      effect: (fn: () => (() => void) | void) => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
      logger: { warn: vi.fn(), error: vi.fn() },
      inject: (deps: string[], cb: (c: unknown) => void) => {
        const activate = (): void => { cb(make(`${label}>[${deps.join(',')}]`, deps)) }
        if (deps.every(available)) activate()
        else parked.push({ deps, activate })
      },
    }
    Object.defineProperty(ctx, 'slots', { get: () => { read('slots'); return slots } })
    Object.defineProperty(ctx, 'settingsScope', {
      get: () => {
        read('settingsScope')
        return { bind: () => ({ get: () => ({}), watch: () => () => {}, subscribe: () => () => {} }) }
      },
    })
    Object.defineProperty(ctx, 'remote', {
      get: () => {
        read('remote')
        return {
          get usageBilling() {
            const ok = decl.has('remote.usageBilling')
            faceReads.push({ from: label, declared: ok })
            if (!ok) throw new Error('cannot get property "remote.usageBilling" without inject')
            return mounted.value ? face : undefined
          },
          // 真 $mount 先 await 挂载事务：面至少在下一个微任务才出现。
          $mount: async () => {
            await Promise.resolve()
            mounted.value = true
            flush()
            return async () => {}
          },
        }
      },
    })
    return ctx
  }

  return {
    ctx: make('root', ['slots', 'remote', 'settingsScope']),
    face,
    serviceReads,
    faceReads,
    registered,
    disposers,
    /** 排空微任务：`$mount` 解析 -> 面出现 -> 第二层 inject 激活。 */
    settle: async (): Promise<void> => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve()
    },
  }
}

describe('client apply —— 面未就绪 / 读面必须声明（真浏览器崩溃的回归）', () => {
  it('面（$mount）就绪前不落地注册，就绪后由第二层同步注册三个槽位', async () => {
    const h = fakeFaceScopedCtx()
    expect(() => apply(h.ctx as never)).not.toThrow()
    // 此刻读 remote.usageBilling 只会抛 without inject —— 注册绝不能提前落在这一层。
    expect(h.registered).toHaveLength(0)
    await h.settle()
    expect(h.registered.map((r) => `${r.slot}#${r.id}`)).toEqual([
      `sidebar.footer.action#${ENTRY_SLOT_ID}`,
      `shell.overlay#${OVERLAY_SLOT_ID}`,
      `settings.section#${SETTINGS_SECTION_ID}`,
    ])
  })

  it('三个槽位工厂都不抛：读面只发生在声明了 remote.usageBilling 的那层 ctx 上', async () => {
    const h = fakeFaceScopedCtx()
    apply(h.ctx as never)
    await h.settle()
    expect(h.registered).toHaveLength(3)

    // 真浏览器里就是这一步崩的（slot entry crashed：注册成功、渲染即抛）。
    const props: Array<Record<string, unknown>> = []
    for (const r of h.registered) {
      let injected: Record<string, unknown> | undefined
      expect(() => { injected = r.inject() }).not.toThrow()
      props.push(injected as Record<string, unknown>)
    }
    // 面必须真的被取到（而不是「靠 undefined 绕过抛错」）。
    for (const p of props) expect(p.billing).toBe(h.face)

    // 读面动作逐条钉住：声明过才允许读，未声明的一次都不能有。
    expect(h.faceReads).toHaveLength(h.registered.length)
    expect(h.faceReads.every((r) => r.declared)).toBe(true)
    expect(h.faceReads[0]?.from).toContain('remote.usageBilling')
    expect(h.serviceReads.filter((r) => !r.declared)).toEqual([])
  })
})
