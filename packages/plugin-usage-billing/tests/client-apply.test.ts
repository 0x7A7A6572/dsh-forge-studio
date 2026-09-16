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
    // fiber stop：收集到的注册 disposer 必须真的把注册收回。
    expect(h.disposers).toHaveLength(3)
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
