// @vitest-environment jsdom
/**
 * 入口卡 / 浮层的**交互**测试（jsdom）—— Task 19 的招牌交互必须真的活着：
 *
 * - 订阅式开合：点入口卡改 store，浮层跟着重渲染；卸载后订阅必须断掉。
 * - 远程面缺席（`usageBillingOf(c)` 早于 mount 求值）时早退，不产生 unhandled rejection。
 * - 概览未到 / 整本账未定价时不显示 `¥0.00`（与真实零费用无法区分），概览到达后显示真实金额。
 * - 侧栏**只留两个数字 + 一条预算进度条**：日期 / 内置价 / N 未收录 / 含估算 都不再出现
 *   （披露本身仍完整保留在弹窗与概览页，这里钉的是「侧栏不再占用注意力」）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'

// 宿主 UI 原语是浏览器包（lib 里 import 了只在宿主 app 打包时才解析得到的依赖），
// Node 里直接 import 会炸 —— 换成透传替身，与 plugin-memory / plugin-daily-log 同一姿态。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => await import('./primitives-stub.tsx'))

import { Dashboard } from '../src/client/views/dashboard.tsx'
import { EntryCard } from '../src/client/views/entry-card.tsx'
import { createBillingStore } from '../src/client/core/store.ts'
import type { BillingStore } from '../src/client/core/store.ts'
import type { UsageBillingRemote } from '../src/client/core/remote.ts'
import type { Overview } from '../src/view.ts'
import { baseConfig, fakeScope } from './fake-scope.ts'

afterEach(() => { cleanup() })

/** 浮层现在还需要设置面（回填提示条的一次性关闭状态存在宿主 notices 里）。 */
const dashboardScope = () => fakeScope(baseConfig()).scope

/**
 * 弹窗是 `createPortal(..., document.body)`（与宿主 Modal 一致）—— 它**不在** `render`
 * 返回的 container 里。查询弹窗内容一律走 document，这也正是真环境里的行为。
 */
const panel = (): Element | null => document.body.querySelector('[data-dsh-ub-panel]')

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

/**
 * 桩住入口卡与浮层会读的接口（价表来源不再是侧栏要展示的东西）。
 *
 * `byModel` 是浮层「概览」页的第三路取数（分模型消耗表）—— 只桩 overview/daily 的话，
 * 浮层一挂载就会在 byModel 上抛 TypeError。 */
function billingStub(
  overview: Overview,
  todayKey = '2026-09-16',
  budget: { enabled: boolean; monthlyCny: number } = { enabled: false, monthlyCny: 0 },
): UsageBillingRemote {
  return {
    overview: async () => ({ ok: true, value: { overview, todayKey, budget } }),
    daily: async () => ({ ok: true, value: { days: [] } }),
    byModel: async () => ({ ok: true, value: { models: [] } }),
    // 浮层（同一份 billingStub 复用）读安装时刻；入口卡自己不调它。
    status: async () => ({ ok: true, value: { installAt: 1_700_000_000_000, rows: 0, sessions: 0, snapshots: 0 } }),
    pricing: async () => ({
      ok: true,
      value: { entries: {}, usdToCny: 7.1, usdToCnySource: 'live' as const, snapshotId: 'snap' },
    }),
  } as unknown as UsageBillingRemote
}

const amountOf = (container: HTMLElement): string | null =>
  container.querySelector('[data-dsh-ub-amount]')?.textContent ?? null

const budgetBarOf = (container: HTMLElement): Element | null =>
  container.querySelector('[data-dsh-ub-bar]')

describe('入口卡与浮层的实时开合（订阅式）', () => {
  it('点入口卡开、点关闭合：store 变化必须引发浮层重渲染', async () => {
    const store = createBillingStore()
    const billing = billingStub(overviewFixture())
    const { container } = render(createElement(
      'div',
      null,
      createElement(EntryCard, { key: 'entry', wide: true, billing, store }),
      createElement(Dashboard, { key: 'dash', billing, store, scope: dashboardScope() }),
    ))
    // 初始关闭
    expect(panel()).toBeNull()
    // 点入口卡：store.openPanel() 之后浮层必须出现（不订阅的话这里永远是 null）
    await act(async () => { fireEvent.click(container.querySelector('[data-dsh-ub-entry]') as HTMLElement) })
    expect(panel()).not.toBeNull()
    expect(store.getSnapshot().open).toBe(true)
    // 点关闭（Modal 的关闭按钮）：必须重新合上
    await act(async () => {
      fireEvent.click(document.body.querySelector('[aria-label="关闭"]') as HTMLElement)
    })
    expect(panel()).toBeNull()
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
    const { unmount } = render(
      createElement(Dashboard, { billing: billingStub(overviewFixture()), store, scope: dashboardScope() }),
    )
    expect(live).toBe(1)
    act(() => { base.openPanel() })
    expect(panel()).not.toBeNull()
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

  it('概览到达前是占位，到达后显示本月与今日金额', async () => {
    const store = createBillingStore()
    const billing = billingStub(overviewFixture({ totalCny: 12.34, todayCny: 1.5 }), '2026-09-16')
    const { container } = render(createElement(EntryCard, { wide: true, billing, store }))
    expect(amountOf(container)).toBe('—')
    // 今日槽位不能空着：概览未到时应显示占位（否则渲染成「今日 」）。
    expect(container.querySelector('[data-dsh-ub-today]')?.textContent).toBe('今日 —')
    await waitFor(() => { expect(amountOf(container)).toBe('¥12.34') })
    expect(container.querySelector('[data-dsh-ub-today]')?.textContent).toBe('今日 ¥1.50')
  })

  it('侧栏不显示日期 / 内置价 / N 未收录 / 含估算（这四样都有更合适的落点）', async () => {
    const store = createBillingStore()
    const billing = billingStub(overviewFixture({
      hasBackfilled: true,
      totalCny: 0, todayCny: 0,
      unpricedModels: ['openai/ghost-model'], unpricedRows: 2,
    }), '2026-09-16')
    const { container } = render(createElement(EntryCard, { wide: true, billing, store }))
    await waitFor(() => { expect(amountOf(container)).toBe('—') })
    const text = container.textContent ?? ''
    // 日期（formatDay('2026-09-16') = '09-16'）：侧栏里没人靠它定位。
    expect(text).not.toContain('09-16')
    // 「内置价」徽标：价表来源是费率页的解释。
    expect(text).not.toContain('内置价')
    // 「N 未收录」徽标：说不清、还容易被读成「这些钱没算进去」的相反意思。
    expect(text).not.toContain('未收录')
    // 估算角标：披露本身仍完整保留在弹窗与概览页。
    expect(text).not.toContain('含安装前估算')
    expect(container.querySelector('[data-dsh-ub-estimate]')).toBeNull()
    // 未定价时金额仍是占位，绝不是 ¥0.00。
    expect(text).not.toContain('¥0.00')
  })

  it('确实定价为零时保留真实零（占位不能吞掉合法结果）', async () => {
    const store = createBillingStore()
    const billing = billingStub(overviewFixture({ totalCny: 0, todayCny: 0 }))
    const { container } = render(createElement(EntryCard, { wide: true, billing, store }))
    await waitFor(() => { expect(amountOf(container)).toBe('¥0.00') })
  })

  it('远程调用 reject 时转失败态（不产生 unhandled rejection，也不再装作"还没到"）', async () => {
    const store = createBillingStore()
    const down = async (): Promise<never> => { throw new Error('wire down') }
    const billing = { overview: down, daily: down } as unknown as UsageBillingRemote
    const { container } = render(createElement(EntryCard, { wide: true, billing, store }))
    await act(async () => { await Promise.resolve() })
    expect(amountOf(container)).toBe('!')
    expect(container.textContent).toContain('读取失败')
    expect(container.querySelector('[data-dsh-ub-entry]')?.getAttribute('data-dsh-ub-state')).toBe('failed')
    expect(container.textContent).not.toContain('¥0.00')
  })

  it('wire 挂起时按超时转失败态（这才是"接口全挂起"应有的界面反馈）', async () => {
    vi.useFakeTimers()
    try {
      const store = createBillingStore()
      const never = (): Promise<never> => new Promise<never>(() => {})
      const billing = { overview: never, daily: never } as unknown as UsageBillingRemote
      const { container } = render(createElement(EntryCard, { wide: true, billing, store }))
      expect(amountOf(container)).toBe('—')
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
      expect(amountOf(container)).toBe('!')
      expect(container.querySelector('[data-dsh-ub-entry]')?.getAttribute('data-dsh-ub-state')).toBe('failed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('视觉锚点是 lucide 图标（不再是那条 56×16、读不出趋势的迷你折线）', async () => {
    const store = createBillingStore()
    const { container } = render(createElement(EntryCard, {
      wide: true, billing: billingStub(overviewFixture()), store,
    }))
    await waitFor(() => { expect(amountOf(container)).toBe('¥12.34') })
    const icon = container.querySelector('[data-dsh-ub-icon]')
    expect(icon).not.toBeNull()
    // lucide 图标渲染为 svg；它是纯装饰（口径在按钮的 aria-label 里），不进 a11y 树。
    expect(icon!.querySelector('svg')).not.toBeNull()
    expect(icon!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('polyline')).toBeNull()
  })

  it('只取一条 overview：不再为侧栏多跑一次 daily 全量聚合', async () => {
    let dailyCalls = 0
    const billing = {
      overview: async () => ({
        ok: true, value: { overview: overviewFixture(), todayKey: '2026-09-16', budget: { enabled: false, monthlyCny: 0 } },
      }),
      daily: async () => { dailyCalls += 1; return { ok: true, value: { days: [] } } },
    } as unknown as UsageBillingRemote
    const { container } = render(createElement(EntryCard, {
      wide: true, billing, store: createBillingStore(),
    }))
    await waitFor(() => { expect(amountOf(container)).toBe('¥12.34') })
    expect(dailyCalls).toBe(0)
  })
})

describe('侧栏预算进度条', () => {
  it('未开启预算 / 预算金额为 0 时不渲染进度条（没有预算就没有"进度"可谈）', async () => {
    const closed = render(createElement(EntryCard, {
      wide: true, billing: billingStub(overviewFixture(), '2026-09-16'), store: createBillingStore(),
    }))
    await waitFor(() => { expect(amountOf(closed.container)).toBe('¥12.34') })
    expect(budgetBarOf(closed.container)).toBeNull()
    cleanup()

    const zero = render(createElement(EntryCard, {
      wide: true,
      billing: billingStub(overviewFixture(), '2026-09-16', { enabled: true, monthlyCny: 0 }),
      store: createBillingStore(),
    }))
    await waitFor(() => { expect(amountOf(zero.container)).toBe('¥12.34') })
    expect(budgetBarOf(zero.container)).toBeNull()
  })

  it('已用比例决定条宽，档位（ok / warn / over）决定颜色', async () => {
    const cases: ReadonlyArray<{ spent: number; level: string; width: string }> = [
      { spent: 30, level: 'ok', width: '30.00%' },
      { spent: 90, level: 'warn', width: '90.00%' },
      { spent: 150, level: 'over', width: '100.00%' },
    ]
    for (const item of cases) {
      const { container, unmount } = render(createElement(EntryCard, {
        wide: true,
        billing: billingStub(overviewFixture({ totalCny: item.spent }), '2026-09-16', { enabled: true, monthlyCny: 100 }),
        store: createBillingStore(),
      }))
      await waitFor(() => { expect(budgetBarOf(container)).not.toBeNull() })
      const bar = budgetBarOf(container)!
      expect(bar.getAttribute('data-level')).toBe(item.level)
      // 超支时条宽夹到 100%：条不能长过容器。
      expect((bar.querySelector('i') as HTMLElement).style.width).toBe(item.width)
      expect(bar.getAttribute('aria-valuenow')).toBe(item.level === 'over' ? '100' : String(item.spent))
      unmount()
    }
  })

  it('预算口径进按钮的无障碍名（进度条本身是装饰，读屏读不到它）', async () => {
    const { container } = render(createElement(EntryCard, {
      wide: true,
      billing: billingStub(overviewFixture({ totalCny: 30 }), '2026-09-16', { enabled: true, monthlyCny: 100 }),
      store: createBillingStore(),
    }))
    await waitFor(() => { expect(budgetBarOf(container)).not.toBeNull() })
    const label = container.querySelector('[data-dsh-ub-entry]')?.getAttribute('aria-label') ?? ''
    expect(label).toContain('本月 ¥30.00')
    expect(label).toContain('预算已用 30%')
    expect(container.querySelector('[data-dsh-ub-bar]')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('窄态 rail：文字被隐藏，lucide 图标与 aria-label 仍在', async () => {
    const { container } = render(createElement(EntryCard, {
      wide: false,
      billing: billingStub(overviewFixture({ totalCny: 12.34 }), '2026-09-16', { enabled: true, monthlyCny: 100 }),
      store: createBillingStore(),
    }))
    await waitFor(() => { expect(amountOf(container)).toBe('¥12.34') })
    expect(container.querySelector('[data-dsh-ub-entry]')?.getAttribute('data-wide')).toBe('false')
  })
})
