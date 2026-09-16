// @vitest-environment jsdom
/**
 * 入口卡 / 浮层的**交互**测试（jsdom）—— Task 19 的招牌交互必须真的活着：
 *
 * - 订阅式开合：点入口卡改 store，浮层跟着重渲染；卸载后订阅必须断掉。
 * - 远程面缺席（`usageBillingOf(c)` 早于 mount 求值）时早退，不产生 unhandled rejection。
 * - 概览未到 / 整本账未定价时不显示 `¥0.00`（与真实零费用无法区分），概览到达后
 *   显示真实金额，并用 `formatDay` 渲染日期标签。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { Dashboard } from '../src/client/views/dashboard.tsx'
import { EntryCard } from '../src/client/views/entry-card.tsx'
import { createBillingStore } from '../src/client/core/store.ts'
import type { BillingStore } from '../src/client/core/store.ts'
import type { UsageBillingRemote } from '../src/client/core/remote.ts'
import type { Overview } from '../src/view.ts'

afterEach(() => { cleanup() })

function overviewFixture(partial: Partial<Overview> = {}): Overview {
  return {
    totalCny: 12.34,
    todayCny: 1.5,
    weekCny: 3,
    avgDailyCny: 0.5,
    cacheHitRate: 0.5,
    calls: 4,
    unpricedModels: [],
    unpricedRows: 0,
    hasBackfilled: false,
    ...partial,
  }
}

/** 只桩住入口卡会调的三条读接口；其余方法不需要。 */
function billingStub(overview: Overview, todayKey = '2026-09-16'): UsageBillingRemote {
  return {
    overview: async () => ({ ok: true, value: { overview, todayKey, budget: { enabled: false, monthlyCny: 0 } } }),
    daily: async () => ({ ok: true, value: { days: [] } }),
    pricing: async () => ({
      ok: true,
      value: { entries: {}, usdToCny: 7.1, usdToCnySource: 'live' as const, snapshotId: 'snap' },
    }),
  } as unknown as UsageBillingRemote
}

const amountOf = (container: HTMLElement): string | null =>
  container.querySelector('[data-dsh-ub-amount]')?.textContent ?? null

describe('入口卡与浮层的实时开合（订阅式）', () => {
  it('点入口卡开、点关闭合：store 变化必须引发浮层重渲染', async () => {
    const store = createBillingStore()
    const billing = billingStub(overviewFixture())
    const { container } = render(createElement(
      'div',
      null,
      createElement(EntryCard, { key: 'entry', wide: true, billing, store }),
      createElement(Dashboard, { key: 'dash', billing, store }),
    ))
    // 初始关闭
    expect(container.querySelector('[data-dsh-ub-overlay]')).toBeNull()
    // 点入口卡：store.openPanel() 之后浮层必须出现（不订阅的话这里永远是 null）
    await act(async () => { fireEvent.click(container.querySelector('[data-dsh-ub-entry]') as HTMLElement) })
    expect(container.querySelector('[data-dsh-ub-overlay]')).not.toBeNull()
    expect(store.getSnapshot().open).toBe(true)
    // 点关闭：必须重新合上
    await act(async () => {
      fireEvent.click(container.querySelector('[data-dsh-ub-panel] button') as HTMLElement)
    })
    expect(container.querySelector('[data-dsh-ub-overlay]')).toBeNull()
    expect(store.getSnapshot().open).toBe(false)
  })

  it('卸载后订阅被取消：再改 store 不再通知任何监听者', () => {
    const base = createBillingStore()
    let live = 0
    let notified = 0
    const store: BillingStore = {
      ...base,
      getSnapshot: base.getSnapshot,
      subscribe: (listener) => {
        live += 1
        const off = base.subscribe(() => { notified += 1; listener() })
        return () => { live -= 1; off() }
      },
    }
    const { container, unmount } = render(
      createElement(Dashboard, { billing: billingStub(overviewFixture()), store }),
    )
    expect(live).toBe(1)
    act(() => { base.openPanel() })
    expect(container.querySelector('[data-dsh-ub-overlay]')).not.toBeNull()
    expect(notified).toBe(1)

    unmount()
    expect(live).toBe(0)
    act(() => { base.closePanel() })
    // 没有活着的订阅者：这次变更不应再通知任何人
    expect(notified).toBe(1)
  })
})

describe('入口卡的取数与占位', () => {
  it('远程面缺席时早退：不抛 unhandled rejection，金额停在占位', () => {
    const store = createBillingStore()
    const { container } = render(createElement(EntryCard, {
      wide: true, billing: undefined, store,
    }))
    expect(amountOf(container)).toBe('—')
    expect(container.textContent).not.toContain('¥0.00')
  })

  it('概览到达前是占位，到达后显示真实金额与 formatDay 日期标签', async () => {
    const store = createBillingStore()
    const billing = billingStub(overviewFixture({ totalCny: 12.34, todayCny: 1.5 }), '2026-09-16')
    const { container } = render(createElement(EntryCard, { wide: true, billing, store }))
    expect(amountOf(container)).toBe('—')
    await waitFor(() => { expect(amountOf(container)).toBe('¥12.34') })
    const sub = container.querySelector('[data-dsh-ub-sub]')?.textContent ?? ''
    expect(sub).toContain('09-16')   // formatDay('2026-09-16')
    expect(sub).toContain('¥1.50')
  })

  it('整本账未定价时不显示 ¥0.00，只留「未收录」徽标', async () => {
    const store = createBillingStore()
    const billing = billingStub(overviewFixture({
      totalCny: 0, todayCny: 0, unpricedModels: ['openai/ghost-model'], unpricedRows: 2,
    }))
    const { container } = render(createElement(EntryCard, { wide: true, billing, store }))
    await waitFor(() => { expect(container.textContent).toContain('1 未收录') })
    expect(amountOf(container)).toBe('—')
    expect(container.textContent).not.toContain('¥0.00')
  })

  it('确实定价为零时保留真实零（占位不能吞掉合法结果）', async () => {
    const store = createBillingStore()
    const billing = billingStub(overviewFixture({ totalCny: 0, todayCny: 0 }))
    const { container } = render(createElement(EntryCard, { wide: true, billing, store }))
    await waitFor(() => { expect(amountOf(container)).toBe('¥0.00') })
  })
})
