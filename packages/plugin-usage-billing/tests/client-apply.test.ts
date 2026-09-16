import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { ENTRY_SLOT_ID, OVERLAY_SLOT_ID, SETTINGS_SECTION_ID } from '../src/client/index.ts'

/** 极简 slots 假实现：只记录 inject/register 调用。 */
function fakeCtx() {
  const registered: Array<{ slot: string; id: string; order?: number }> = []
  const injected: string[] = []
  const disposers: Array<() => void> = []
  const ctx = {
    effect: (fn: () => (() => void) | void) => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    inject: (deps: string[], cb: (c: unknown) => void) => { void deps; cb(ctx) },
    logger: { warn: vi.fn(), error: vi.fn() },
    slots: {
      inject: (slot: string, cb: () => void) => { injected.push(slot); cb() },
      register: (spec: { name: string; id: string; order?: number }, _component: unknown) => {
        registered.push({ slot: spec.name, id: spec.id, order: spec.order })
        return () => {}
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
    for (const r of registered) expect(r.id).not.toBe('usage-billing')
  })

  it('用声明感知的 slots.inject（不假设 slot 已存在）', () => {
    const { ctx, injected } = fakeCtx()
    apply(ctx as never)
    expect(injected).toContain('sidebar.footer.action')
    expect(injected).toContain('shell.overlay')
    expect(injected).toContain('settings.section')
  })

  it('重复 apply 不抛（DOM 级幂等由 store 保证）', () => {
    const { ctx } = fakeCtx()
    expect(() => { apply(ctx as never); apply(ctx as never) }).not.toThrow()
  })
})
