import { describe, expect, it } from 'vitest'
import { createUsageBillingSettingsAccess, USAGE_BILLING_CONFIG_BASE } from '../src/settings.ts'
import type { UsageBillingConfig } from '../src/settings.ts'

describe('设置访问句柄', () => {
  it('未绑定时 get 返回 base，ready 为 false', () => {
    const a = createUsageBillingSettingsAccess()
    expect(a.ready()).toBe(false)
    expect(a.get()).toEqual(USAGE_BILLING_CONFIG_BASE)
  })

  it('bind 立刻发布当前值，绑定后注册的 watcher 立即拿到一次', () => {
    const a = createUsageBillingSettingsAccess()
    const seen: UsageBillingConfig[] = []
    a.bind({ get: () => ({ ...USAGE_BILLING_CONFIG_BASE, budget: { enabled: true, monthlyCny: 42 } }), watch: () => () => {} })
    a.watch((c) => seen.push(c))
    expect(a.ready()).toBe(true)
    expect(seen.at(-1)!.budget.monthlyCny).toBe(42)
  })

  it('设置变化会推给所有 watcher，取消订阅后不再收到', () => {
    const a = createUsageBillingSettingsAccess()
    let push: ((c: UsageBillingConfig) => void) | undefined
    a.bind({ get: () => USAGE_BILLING_CONFIG_BASE, watch: (cb) => { push = cb; return () => {} } })
    const seen: number[] = []
    const off = a.watch((c) => seen.push(c.budget.monthlyCny))
    push!({ ...USAGE_BILLING_CONFIG_BASE, budget: { enabled: true, monthlyCny: 7 } })
    off()
    push!({ ...USAGE_BILLING_CONFIG_BASE, budget: { enabled: true, monthlyCny: 9 } })
    // 逐字用例断言 [7]，与上一用例「绑定后注册的 watcher 立即拿到一次」互斥（注册时已收到 base 的 100），
    // 二者不可同时成立；此处保留「推送 7 已收到、退订后 9 未收到」的验证意图，详见 task-11-report.md。
    expect(seen).toEqual([100, 7])
  })

  it('dispose 后停止接收且 ready 为 false', () => {
    const a = createUsageBillingSettingsAccess()
    let push: ((c: UsageBillingConfig) => void) | undefined
    a.bind({ get: () => USAGE_BILLING_CONFIG_BASE, watch: (cb) => { push = cb; return () => {} } })
    a.dispose()
    expect(a.ready()).toBe(false)
    push?.({ ...USAGE_BILLING_CONFIG_BASE, budget: { enabled: true, monthlyCny: 1 } })
    expect(a.get().budget.monthlyCny).toBe(USAGE_BILLING_CONFIG_BASE.budget.monthlyCny)
  })
})
