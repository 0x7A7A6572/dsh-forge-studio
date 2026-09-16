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
    expect(seen).toEqual([100, 7])
  })

  it('dispose 后再次 bind 会复位：新 scope 的值与推送都生效', () => {
    const a = createUsageBillingSettingsAccess()
    a.bind({
      get: () => ({ ...USAGE_BILLING_CONFIG_BASE, budget: { enabled: true, monthlyCny: 11 } }),
      watch: () => () => {},
    })
    a.dispose()

    let push: ((c: UsageBillingConfig) => void) | undefined
    a.bind({
      get: () => ({ ...USAGE_BILLING_CONFIG_BASE, budget: { enabled: true, monthlyCny: 22 } }),
      watch: (cb) => { push = cb; return () => {} },
    })
    const seen: number[] = []
    a.watch((c) => seen.push(c.budget.monthlyCny))

    expect(a.ready()).toBe(true)
    expect(a.get().budget.monthlyCny).toBe(22)

    push!({ ...USAGE_BILLING_CONFIG_BASE, budget: { enabled: true, monthlyCny: 33 } })
    expect(seen).toEqual([22, 33])
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
