// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BackfillLedgerNote, BackfillNotice } from '../src/client/views/backfill-notice.tsx'
import { Dashboard } from '../src/client/views/dashboard.tsx'
import { Sparkline, BarChart } from '../src/client/views/chart.tsx'
import { createBillingStore } from '../src/client/core/store.ts'
import type { UsageBillingRemote } from '../src/client/core/remote.ts'
import type { Overview } from '../src/view.ts'
import { TabOverview } from '../src/client/views/tab-overview.tsx'
import { TabTrend } from '../src/client/views/tab-trend.tsx'
import { evaluateBudget } from '../src/budget.ts'

// 本仓没有 vitest 配置、`globals` 关闭，RTL 的自动 cleanup 依赖全局 afterEach 因而失效；
// 不显式清理的话上一用例的 DOM 会留下（表现就是 getByRole('button') 命中多个）。
afterEach(() => { cleanup() })

describe('BackfillNotice', () => {
  it('未关闭时显示提示，含安装时刻', () => {
    render(<BackfillNotice installAt={Date.UTC(2026, 8, 16, 6, 0)} dismissed={false} onDismiss={() => {}} />)
    expect(screen.getByText(/安装前/)).toBeTruthy()
    expect(screen.getByText(/估算/)).toBeTruthy()
  })

  it('已关闭时完全不渲染', () => {
    const { container } = render(<BackfillNotice installAt={1} dismissed onDismiss={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('点关闭调用 onDismiss', () => {
    const onDismiss = vi.fn()
    render(<BackfillNotice installAt={1} dismissed={false} onDismiss={onDismiss} />)
    screen.getByRole('button').click()
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

describe('BackfillLedgerNote', () => {
  it('常驻口径说明含快照 id', () => {
    render(<BackfillLedgerNote installAt={Date.UTC(2026, 8, 16, 6, 0)} snapshotId="snap-install" />)
    expect(screen.getByText(/snap-install/)).toBeTruthy()
  })
})

/**
 * 空账本概览：`overview` 的契约类型是 `Overview`（host 从不返回 null）。
 * 视图骨架阶段这里写的是 `overview: null as never`，真实组件读 `overview.totalCny`
 * 时会炸 —— Dashboard 默认停在概览 tab，于是 Dashboard 三个用例都会带出未捕获异常。
 */
const emptyOverview: Overview = {
  totalCny: 0, todayCny: 0, weekCny: 0, avgDailyCny: 0, cacheHitRate: 0, calls: 0,
  unpricedModels: [], unpricedRows: 0, hasBackfilled: false,
}

const noopRemote = (over: Partial<UsageBillingRemote> = {}): UsageBillingRemote => ({
  overview: async () => ({ ok: true, value: { overview: emptyOverview, todayKey: '2026-09-16', budget: { enabled: false, monthlyCny: 0 } } }),
  daily: async () => ({ ok: true, value: { days: [] } }),
  byModel: async () => ({ ok: true, value: { models: [] } }),
  bySession: async () => ({ ok: true, value: { sessions: [] } }),
  byWorkspace: async () => ({ ok: true, value: { workspaces: [] } }),
  pricing: async () => ({ ok: true, value: { entries: {}, usdToCny: 7.1, usdToCnySource: 'default', snapshotId: 'snap-install' } }),
  ...over,
} as UsageBillingRemote)

describe('Sparkline / BarChart', () => {
  it('空数据不渲染 svg 内部元素也不抛', () => {
    const { container } = render(<Sparkline values={[]} />)
    expect(container.querySelector('polyline')).toBeNull()
  })
  it('柱状图每根柱都是 rect', () => {
    const { container } = render(<BarChart values={[1, 2, 3]} labels={['a', 'b', 'c']} width={90} height={30} />)
    expect(container.querySelectorAll('rect')).toHaveLength(3)
  })
})

describe('Dashboard', () => {
  it('弹窗关闭时不渲染面板', () => {
    const store = createBillingStore({ open: false })
    const { container } = render(<Dashboard billing={noopRemote()} store={store} />)
    expect(container.querySelector('[data-dsh-ub-panel]')).toBeNull()
  })

  it('打开后渲染面板与五个 tab', () => {
    const store = createBillingStore({ open: true })
    render(<Dashboard billing={noopRemote()} store={store} />)
    expect(screen.getByText('概览')).toBeTruthy()
    expect(screen.getByText('趋势')).toBeTruthy()
    expect(screen.getByText('热力图')).toBeTruthy()
    expect(screen.getByText('明细')).toBeTruthy()
    expect(screen.getByText('费率')).toBeTruthy()
  })

  it('遮罩层自带 pointer-events（浮层本身是 click-through 的）', () => {
    const store = createBillingStore({ open: true })
    const { container } = render(<Dashboard billing={noopRemote()} store={store} />)
    expect(container.querySelector('[data-dsh-ub-overlay]')).toBeTruthy()
  })
})

const overviewRemote = (over: Record<string, unknown>) => noopRemote({
  overview: async () => ({ ok: true, value: { overview: { totalCny: 42, todayCny: 3, weekCny: 12, avgDailyCny: 6, cacheHitRate: 0.5, calls: 9, unpricedModels: ['x/mystery'], unpricedRows: 1, hasBackfilled: true, ...over }, todayKey: '2026-09-16', budget: { enabled: true, monthlyCny: 100 } } }),
  daily: async () => ({ ok: true, value: { days: [{ day: '2026-09-15', costCny: 1, input: 10, cacheRead: 0, cacheWrite: 0, output: 5, calls: 1 }] } }),
} as never)

describe('TabOverview', () => {
  it('Hero 显示本月费用与今日，未收录有提示，回填有估算角标', async () => {
    render(<TabOverview billing={overviewRemote({})} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('¥42.00')).toBeTruthy()
    // brief 原文是 `getByText(/未收录/)`：KPI 标签「未收录模型」、KPI 值「1 未收录」与下方提示条
    // 三处都命中该正则，getByText 会抛 “Found multiple elements”。实现保持 brief 逐字不变，
    // 这里改为分别断言计数徽标与提示条（都仍会失败，不是空断言）。
    expect(screen.getByText('1 未收录')).toBeTruthy()
    expect(screen.getByText(/条记录涉及/)).toBeTruthy()
    expect(screen.getByText(/估算/)).toBeTruthy()
  })

  it('预算超支时进度条 level=over', async () => {
    const { container } = render(<TabOverview billing={overviewRemote({ totalCny: 150 })} store={createBillingStore({ open: true })} />)
    await screen.findByText('¥150.00')
    expect(container.querySelector('[data-dsh-ub-bar]')!.getAttribute('data-level')).toBe('over')
  })

  it('未收录提示被关掉时不显示', async () => {
    render(<TabOverview billing={overviewRemote({ unpricedModels: [] })} store={createBillingStore({ open: true })} />)
    await screen.findByText('¥42.00')
    // brief 原文是 `queryByText(/未收录/)`：常驻 KPI 标签「未收录模型」恒命中，永远不为 null；
    // 「关掉」的是未收录提示条，所以按提示条断言。
    expect(screen.queryByText(/条记录涉及/)).toBeNull()
  })
})

describe('TabTrend', () => {
  it('费用/Token 指示可切换且渲染柱状图', async () => {
    const store = createBillingStore({ open: true })
    const { container } = render(<TabTrend billing={overviewRemote({})} store={store} />)
    await screen.findByRole('img', { name: '柱状图' })
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0)
  })

  it('evaluateBudget 与 UI 档位一致（同一份纯函数，不重复实现）', () => {
    expect(evaluateBudget({ spentCny: 150, monthlyCny: 100, enabled: true, notified: {}, monthKey: '2026-09' }).level).toBe('over')
  })
})
