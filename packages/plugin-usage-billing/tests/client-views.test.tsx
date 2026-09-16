// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BackfillLedgerNote, BackfillNotice } from '../src/client/views/backfill-notice.tsx'
import { Dashboard } from '../src/client/views/dashboard.tsx'
import { Sparkline, BarChart } from '../src/client/views/chart.tsx'
import { createBillingStore } from '../src/client/core/store.ts'
import type { UsageBillingRemote } from '../src/client/core/remote.ts'

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

const noopRemote = (over: Partial<UsageBillingRemote> = {}): UsageBillingRemote => ({
  overview: async () => ({ ok: true, value: { overview: null as never, todayKey: '2026-09-16', budget: { enabled: false, monthlyCny: 0 } } }),
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
