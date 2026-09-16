// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackfillLedgerNote, BackfillNotice } from '../src/client/views/backfill-notice.tsx'
import { Dashboard } from '../src/client/views/dashboard.tsx'
import { Sparkline, BarChart } from '../src/client/views/chart.tsx'
import { createBillingStore } from '../src/client/core/store.ts'
import type { UsageBillingRemote } from '../src/client/core/remote.ts'
import type { DailyPoint, Overview } from '../src/view.ts'
import type { CustomPriceInput, PriceEntry } from '../src/types.ts'
import { TabOverview } from '../src/client/views/tab-overview.tsx'
import { TabTrend } from '../src/client/views/tab-trend.tsx'
import { TabHeatmap } from '../src/client/views/tab-heatmap.tsx'
import { TabDetail } from '../src/client/views/tab-detail.tsx'
import { TabPricing } from '../src/client/views/tab-pricing.tsx'
import { SettingsSection } from '../src/client/views/settings-section.tsx'
import { evaluateBudget } from '../src/budget.ts'
import { baseConfig, fakeScope } from './fake-scope.ts'

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
  it('常驻口径说明含快照 id，且覆盖每个标了估算的分区', () => {
    render(<BackfillLedgerNote installAt={Date.UTC(2026, 8, 16, 6, 0)} snapshotId="snap-install" />)
    expect(screen.getByText(/snap-install/)).toBeTruthy()
    // 提示条只列了「概览与趋势」时，热力图/明细的「估算」角标没有对应的口径说明 ——
    // 四个分区都必须出现在这句常驻文案里。
    expect(screen.getByText(/概览、趋势、热力图与明细/)).toBeTruthy()
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
  daily: async () => ({ ok: true, value: { days: [], hasBackfilled: false, unpricedModels: [] } }),
  byModel: async () => ({ ok: true, value: { models: [], hasBackfilled: false, unpricedModels: [] } }),
  bySession: async () => ({ ok: true, value: { sessions: [] } }),
  byWorkspace: async () => ({ ok: true, value: { workspaces: [], hasBackfilled: false, unpricedModels: [] } }),
  pricing: async () => ({ ok: true, value: { entries: {}, usdToCny: 7.1, usdToCnySource: 'default', snapshotId: 'snap-install', customKeys: [] } }),
  ...over,
} as UsageBillingRemote)

const dash = (props: {
  billing: UsageBillingRemote | undefined
  store: ReturnType<typeof createBillingStore>
  writable?: boolean
}) => (
  <Dashboard billing={props.billing} store={props.store}
    scope={fakeScope(baseConfig(), { writable: props.writable ?? true }).scope} />
)

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
    const { container } = render(dash({ billing: noopRemote(), store }))
    expect(container.querySelector('[data-dsh-ub-panel]')).toBeNull()
  })

  it('打开后渲染面板与五个 tab', () => {
    const store = createBillingStore({ open: true })
    render(dash({ billing: noopRemote(), store }))
    expect(screen.getByText('概览')).toBeTruthy()
    expect(screen.getByText('趋势')).toBeTruthy()
    expect(screen.getByText('热力图')).toBeTruthy()
    expect(screen.getByText('明细')).toBeTruthy()
    expect(screen.getByText('费率')).toBeTruthy()
  })

  it('遮罩层自带 pointer-events（浮层本身是 click-through 的）', () => {
    const store = createBillingStore({ open: true })
    const { container } = render(dash({ billing: noopRemote(), store }))
    expect(container.querySelector('[data-dsh-ub-overlay]')).toBeTruthy()
  })

  it('远程面缺席（首帧 $mount 未完成）时每个 tab 都不抛', async () => {
    const store = createBillingStore({ open: true })
    const { container } = render(dash({ billing: undefined, store }))
    // 默认概览 tab：effect 早退，停在读取态而不是 TypeError。
    expect(await screen.findByText('正在读取用量…')).toBeTruthy()
    for (const tab of ['趋势', '热力图', '明细', '费率']) {
      act(() => { screen.getByText(tab).click() })
      expect(container.textContent).toContain('读取')
    }
  })

  it('回填提示条：弹窗顶部渲染，点「知道了」写宿主 notices 后永久消失（重挂也不回来）', async () => {
    const store = createBillingStore({ open: true })
    const h = fakeScope(baseConfig())
    const { container, unmount } = render(<Dashboard billing={noopRemote()} store={store} scope={h.scope} />)
    expect(container.querySelector('[data-dsh-ub-notice]')).toBeTruthy()

    const dismiss = container.querySelector('[data-dsh-ub-notice] button') as HTMLElement
    await act(async () => { fireEvent.click(dismiss) })
    expect(h.writes).toContainEqual({
      field: 'notices', value: { backfillDismissed: true, budgetNotified: {} },
    })
    expect(container.querySelector('[data-dsh-ub-notice]')).toBeNull()

    // 一次性：同一份宿主设置（已 dismissed）重新挂载也不再出现 —— 不是本地一次性 state。
    unmount()
    const again = render(<Dashboard billing={noopRemote()} store={createBillingStore({ open: true })} scope={h.scope} />)
    expect(again.container.querySelector('[data-dsh-ub-notice]')).toBeNull()
  })
})

const overviewRemote = (over: Record<string, unknown>, dailyOver: Record<string, unknown> = {}) => noopRemote({
  overview: async () => ({ ok: true, value: { overview: { totalCny: 42, todayCny: 3, weekCny: 12, avgDailyCny: 6, cacheHitRate: 0.5, calls: 9, unpricedModels: ['x/mystery'], unpricedRows: 1, hasBackfilled: true, ...over }, todayKey: '2026-09-16', budget: { enabled: true, monthlyCny: 100 } } }),
  daily: async () => ({ ok: true, value: { days: [{ day: '2026-09-15', costCny: 1, input: 10, cacheRead: 0, cacheWrite: 0, output: 5, calls: 1 }], hasBackfilled: true, unpricedModels: [], ...dailyOver } }),
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

  it('整份账一行都没定价：Hero 与日均显示占位，绝不显示 ¥0.00', async () => {
    const { container } = render(<TabOverview
      billing={overviewRemote({ totalCny: 0, todayCny: 0, weekCny: 0, avgDailyCny: 0, calls: 3, unpricedModels: ['x/mystery'], unpricedRows: 3 })}
      store={createBillingStore({ open: true })} />)
    await waitFor(() => {
      expect(container.querySelector('[data-dsh-ub-hero]')?.textContent).toBe('—')
    })
    const avgKpi = screen.getByText('日均').parentElement!
    expect(avgKpi.textContent).toContain('—')
    expect(avgKpi.textContent).not.toContain('¥0.00')
    // 未收录徽标与计数不变：占位只换金额，不吞披露。
    expect(screen.getByText('1 未收录')).toBeTruthy()
  })

  it('真实零（无未收录模型）时 Hero 保留 ¥0.00 —— 占位不能吞掉合法结果', async () => {
    const { container } = render(<TabOverview
      billing={overviewRemote({ totalCny: 0, todayCny: 0, weekCny: 0, avgDailyCny: 0, unpricedModels: [], unpricedRows: 0 })}
      store={createBillingStore({ open: true })} />)
    await waitFor(() => {
      expect(container.querySelector('[data-dsh-ub-hero]')?.textContent).toBe('¥0.00')
    })
    expect(screen.getByText('日均').parentElement!.textContent).toContain('¥0.00')
  })

  it('远程面缺席时 effect 早退（不抛 TypeError）', async () => {
    render(<TabOverview billing={undefined} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('正在读取用量…')).toBeTruthy()
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

  it('回填披露随 daily 响应同源到达：二次 overview 取数失败也不能让标记消失', async () => {
    let overviewCalls = 0
    const billing = noopRemote({
      // 二次取数（review 前 trend 用它单独判回填）在这里必然失败 —— 披露仍必须在。
      overview: async () => { overviewCalls += 1; return { ok: false, error: { message: 'secondary fetch down' } } as never },
      daily: async () => ({ ok: true, value: {
        days: [{ day: '2026-09-15', costCny: 1, input: 10, cacheRead: 0, cacheWrite: 0, output: 5, calls: 1 }],
        hasBackfilled: true, unpricedModels: [],
      } }),
    } as never)
    render(<TabTrend billing={billing} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('含安装前估算')).toBeTruthy()
    // 金额确实渲染了：披露与它描述的数据同屏，不存在「金额在、标记没了」的窗口。
    expect(screen.getByText(/合计/).textContent).toContain('¥1.00')
    expect(overviewCalls).toBe(0)
  })

  it('daily 自报无回填时不显示估算角标（披露随数据，不被保守兜底吞掉）', async () => {
    const billing = noopRemote({
      daily: async () => ({ ok: true, value: {
        days: [{ day: '2026-09-15', costCny: 1, input: 10, cacheRead: 0, cacheWrite: 0, output: 5, calls: 1 }],
        hasBackfilled: false, unpricedModels: [],
      } }),
    } as never)
    render(<TabTrend billing={billing} store={createBillingStore({ open: true })} />)
    await screen.findByRole('img', { name: '柱状图' })
    expect(screen.queryByText('含安装前估算')).toBeNull()
  })

  it('整份账未定价：合计与每日行都是占位，不是 ¥0.00', async () => {
    const zeroDay: DailyPoint = { day: '2026-09-15', costCny: 0, input: 10, cacheRead: 0, cacheWrite: 0, output: 5, calls: 1 }
    const billing = noopRemote({
      daily: async () => ({ ok: true, value: { days: [zeroDay], hasBackfilled: false, unpricedModels: ['x/mystery'] } }),
    } as never)
    render(<TabTrend billing={billing} store={createBillingStore({ open: true })} />)
    const total = await screen.findByText(/合计/)
    expect(total.textContent).toContain('—')
    expect(total.textContent).not.toContain('¥0.00')
    expect(screen.getByText(/2026-09-15/).textContent).toContain('—')
  })

  it('真实零（无未收录模型）时合计保留 ¥0.00', async () => {
    const zeroDay: DailyPoint = { day: '2026-09-15', costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 }
    const billing = noopRemote({
      daily: async () => ({ ok: true, value: { days: [zeroDay], hasBackfilled: false, unpricedModels: [] } }),
    } as never)
    render(<TabTrend billing={billing} store={createBillingStore({ open: true })} />)
    await waitFor(() => { expect(screen.getByText(/合计/).textContent).toContain('¥0.00') })
  })

  it('远程面缺席时 effect 早退（不抛 TypeError）', async () => {
    render(<TabTrend billing={undefined} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('正在读取用量…')).toBeTruthy()
  })
})

const heatRemote = (markers: { hasBackfilled: boolean; unpricedModels: string[] } = { hasBackfilled: false, unpricedModels: [] }) => noopRemote({
  daily: async () => ({ ok: true, value: { days: [
    { day: '2026-09-01', costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 },
    { day: '2026-09-02', costCny: 5, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 1 },
  ], ...markers } }),
} as never)

const detailRemote = () => noopRemote({
  byWorkspace: async () => ({ ok: true, value: {
    workspaces: [
      { cwd: 'D:\\codes\\demo', calls: 2, costCny: 7, sessions: [
        { sessionId: 's1', day: '2026-09-16', calls: 2, costCny: 7, lastTime: 1, isSubagent: false },
      ] },
    ],
    hasBackfilled: false, unpricedModels: [],
  } }),
  byModel: async () => ({ ok: true, value: { models: [
    { key: 'deepseek/deepseek-v4-flash', provider: 'deepseek', model: 'deepseek-v4-flash', rawModels: ['deepseek-v4-flash'],
      input: 10, cacheRead: 0, cacheWrite: 0, output: 5, reasoning: 0, costCny: 7, priced: true, mixedRate: false, calls: 2 },
  ], hasBackfilled: false, unpricedModels: [] } }),
} as never)

/**
 * 混合单价 + 未收录 + 回填标记都有的明细 fixture。
 * 此前这里只有 `priced: true` 一行，于是「未收录」分支和回填标记从来没有被任何断言覆盖。
 */
const detailMixedRemote = () => noopRemote({
  byWorkspace: async () => ({ ok: true, value: {
    workspaces: [
      { cwd: 'D:\\codes\\demo', calls: 2, costCny: 7, sessions: [
        { sessionId: 's1', day: '2026-09-16', calls: 2, costCny: 7, lastTime: 1, isSubagent: false },
      ] },
    ],
    hasBackfilled: true, unpricedModels: ['openai/ghost-model'],
  } }),
  byModel: async () => ({ ok: true, value: { models: [
    { key: 'deepseek/deepseek-v4-flash', provider: 'deepseek', model: 'deepseek-v4-flash',
      rawModels: ['deepseek-v4-flash', 'deepseek-v4-flash-20260518'],
      input: 10, cacheRead: 0, cacheWrite: 0, output: 5, reasoning: 0, costCny: 7, priced: true, mixedRate: true, calls: 2 },
    { key: 'openai/ghost-model', provider: 'openai', model: 'ghost-model', rawModels: ['ghost-model'],
      input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, costCny: 0, priced: false, mixedRate: false, calls: 1 },
  ], hasBackfilled: true, unpricedModels: ['openai/ghost-model'] } }),
} as never)

describe('TabHeatmap', () => {
  it('渲染 5 档热力格，活跃天与总天数是文字', async () => {
    const { container } = render(<TabHeatmap billing={heatRemote()} store={createBillingStore({ open: true })} />)
    await screen.findByText(/活跃/)
    expect(container.querySelectorAll('[data-dsh-ub-heat] > span').length).toBeGreaterThanOrEqual(2)
  })
  it('无数据时给空态而不是空白', async () => {
    render(<TabHeatmap billing={noopRemote()} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/还没有用量记录/)).toBeTruthy()
  })
  it('回填披露随 daily 响应到达（二次 overview 失败也不消失）', async () => {
    let overviewCalls = 0
    const billing = noopRemote({
      overview: async () => { overviewCalls += 1; return { ok: false, error: { message: 'down' } } as never },
      daily: async () => ({ ok: true, value: { days: [
        { day: '2026-09-02', costCny: 5, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 1 },
      ], hasBackfilled: true, unpricedModels: [] } }),
    } as never)
    render(<TabHeatmap billing={billing} store={createBillingStore({ open: true })} />)
    // 热力图的角标把分隔号也包在 span 里（「· 含安装前估算」），故用正则。
    expect(await screen.findByText(/含安装前估算/)).toBeTruthy()
    expect(overviewCalls).toBe(0)
  })
  it('整份账未定价时格子 title 是占位而不是 ¥0.00', async () => {
    const billing = noopRemote({
      daily: async () => ({ ok: true, value: { days: [
        { day: '2026-09-02', costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 1 },
      ], hasBackfilled: false, unpricedModels: ['x/mystery'] } }),
    } as never)
    const { container } = render(<TabHeatmap billing={billing} store={createBillingStore({ open: true })} />)
    await screen.findByText(/活跃/)
    const titles = [...container.querySelectorAll('[data-dsh-ub-heat] > span')].map((s) => s.getAttribute('title') ?? '')
    expect(titles.join('|')).toContain('—')
    expect(titles.join('|')).not.toContain('¥0.00')
  })
  it('远程面缺席时 effect 早退（不抛 TypeError）', async () => {
    render(<TabHeatmap billing={undefined} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('正在读取用量…')).toBeTruthy()
  })
})

describe('TabDetail', () => {
  it('工作区行可展开到会话', async () => {
    render(<TabDetail billing={detailRemote()} store={createBillingStore({ open: true })} />)
    // brief 原文是 `/D:\\\\codes\\\\demo/`：正则里 `\\\\` 匹配两个字面反斜杠，而 fixture 的
    // `'D:\\codes\\demo'` 求值后只有一个，永远匹配不到。改为与渲染文本同形的单反斜杠正则。
    const w = await screen.findByText(/D:\\codes\\demo/)
    w.click()
    expect(await screen.findByText(/s1/)).toBeTruthy()
  })

  it('模型表把混合单价、未收录与原始 id 数都标出来（断言与用例名一致）', async () => {
    render(<TabDetail billing={detailMixedRemote()} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/deepseek-v4-flash/)).toBeTruthy()
    expect(screen.getByText(/混合单价/)).toBeTruthy()
    expect(screen.getByText(/2 个原始 id/)).toBeTruthy()
    // 未计价行的费用列必须写「未收录」，绝不能是 ¥0.00。
    expect(screen.getByText('未收录')).toBeTruthy()
    expect(screen.queryByText('¥0.00')).toBeNull()
  })

  it('回填披露随 byWorkspace / byModel 响应到达', async () => {
    render(<TabDetail billing={detailMixedRemote()} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/含安装前估算/)).toBeTruthy()
  })

  it('空账本给空态而不是两张空表', async () => {
    render(<TabDetail billing={noopRemote()} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/还没有用量记录/)).toBeTruthy()
  })

  it('远程面缺席时 effect 早退（不抛 TypeError）', async () => {
    render(<TabDetail billing={undefined} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('正在读取用量…')).toBeTruthy()
  })
})

const pricingRemote = () => noopRemote({
  pricing: async () => ({ ok: true, value: {
    entries: { 'deepseek/deepseek-v4-flash': { input: 0.5, cacheRead: 0.1, cacheWrite: 0.5, output: 2, currency: 'CNY' } },
    usdToCny: 7.1, usdToCnySource: 'default', snapshotId: 'snap-install', customKeys: [],
  } }),
  status: async () => ({ ok: true, value: { installAt: 1_700_000_000_000, rows: 12, sessions: 3, snapshots: 2 } }),
} as never)

/**
 * 有状态费率假件：`setCustomPrice` / `removeCustomPrice` 真的改价表，`pricing()` 反映结果。
 * 只有这样才能证明「保存后新行出现」「删除后回落目录价」而不只是断言远程被调过。
 */
function pricingEditorRemote(opts: { flashIsCustom?: boolean } = {}) {
  const CATALOG: PriceEntry = { input: 0.5, cacheRead: 0.1, cacheWrite: 0.5, output: 2, currency: 'CNY' }
  const KEY = 'deepseek/deepseek-v4-flash'
  let entries: Record<string, PriceEntry> = {
    [KEY]: opts.flashIsCustom === true ? { ...CATALOG, input: 9 } : { ...CATALOG },
  }
  let customKeys: string[] = opts.flashIsCustom === true ? [KEY] : []
  const setCalls: CustomPriceInput[] = []
  const removeCalls: string[] = []
  const billing = noopRemote({
    pricing: async () => ({ ok: true, value: {
      entries: { ...entries }, usdToCny: 7.1, usdToCnySource: 'default', snapshotId: 'snap-install',
      customKeys: [...customKeys],
    } }),
    setCustomPrice: async (entry: CustomPriceInput) => {
      setCalls.push(entry)
      const key = `${entry.provider}/${entry.model}`
      entries = { ...entries, [key]: {
        input: entry.input, cacheRead: entry.cacheRead, cacheWrite: entry.cacheWrite,
        output: entry.output, currency: entry.currency,
      } }
      customKeys = [...new Set([...customKeys, key])].sort()
      return { ok: true, value: { ok: true } }
    },
    removeCustomPrice: async (key: string) => {
      removeCalls.push(key)
      const next = { ...entries }
      if (key === KEY) next[key] = { ...CATALOG }
      else delete next[key]
      entries = next
      customKeys = customKeys.filter((k) => k !== key)
      return { ok: true, value: { ok: true } }
    },
  } as never)
  return { billing, setCalls, removeCalls, entriesNow: () => entries }
}

const fillDraft = (key: string, input: string, cacheRead: string, cacheWrite: string, output: string): void => {
  fireEvent.change(screen.getByLabelText('模型 key'), { target: { value: key } })
  fireEvent.change(screen.getByLabelText('输入'), { target: { value: input } })
  fireEvent.change(screen.getByLabelText('缓存读'), { target: { value: cacheRead } })
  fireEvent.change(screen.getByLabelText('缓存写'), { target: { value: cacheWrite } })
  fireEvent.change(screen.getByLabelText('输出'), { target: { value: output } })
}

describe('TabPricing', () => {
  it('列出价目并标注内置价来源', async () => {
    render(<TabPricing billing={pricingRemote()} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/deepseek-v4-flash/)).toBeTruthy()
    expect(screen.getByText(/内置价/)).toBeTruthy()
  })
  it('提供未计价历史重算入口', async () => {
    render(<TabPricing billing={pricingRemote()} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/重算未计价历史/)).toBeTruthy()
  })

  it('保存自定义单价：远程收到完整单价，刷新后新行以「自定义」出现', async () => {
    const h = pricingEditorRemote()
    render(<TabPricing billing={h.billing} store={createBillingStore({ open: true })} />)
    await screen.findByText(/deepseek-v4-flash/)
    fillDraft('openai/ghost-model', '1', '0.5', '1', '2')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存自定义单价' }))
    })
    expect(h.setCalls).toEqual([{
      provider: 'openai', model: 'ghost-model', currency: 'CNY',
      input: 1, cacheRead: 0.5, cacheWrite: 1, output: 2,
    }])
    expect(await screen.findByText('openai/ghost-model')).toBeTruthy()
    expect(screen.getByText('自定义')).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除 openai/ghost-model' })).toBeTruthy()
  })

  it('删除自定义价：远程被调用，表格回落到目录价且不再标「自定义」', async () => {
    const h = pricingEditorRemote({ flashIsCustom: true })
    render(<TabPricing billing={h.billing} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('自定义')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy() // 自定义后的 input 单价

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除 deepseek/deepseek-v4-flash' }))
    })
    expect(h.removeCalls).toEqual(['deepseek/deepseek-v4-flash'])
    await waitFor(() => { expect(screen.queryByText('自定义')).toBeNull() })
    // 目录价回来了：输入与缓存写都是 0.5，故按「至少一处」断言值本身。
    expect(screen.getAllByText('0.5').length).toBeGreaterThan(0)
    expect(h.entriesNow()['deepseek/deepseek-v4-flash']).toMatchObject({ input: 0.5 })
  })

  it('空 key / 残缺 key / 非数字单价都被拒绝，且一次远程都不发', async () => {
    const h = pricingEditorRemote()
    render(<TabPricing billing={h.billing} store={createBillingStore({ open: true })} />)
    await screen.findByText(/deepseek-v4-flash/)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存自定义单价' })) })
    expect(screen.getByText(/必须是 <provider>\/<model>/)).toBeTruthy()

    fillDraft('openai/', '1', '0', '0', '0')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存自定义单价' })) })
    expect(screen.getByText(/必须是 <provider>\/<model>/)).toBeTruthy()

    fillDraft('openai/ghost-model', 'abc', '0', '0', '0')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存自定义单价' })) })
    expect(screen.getByText(/四个单价都必须是不小于 0 的数字/)).toBeTruthy()

    expect(h.setCalls).toHaveLength(0)
  })

  it('远程面缺席时 effect 早退（不抛 TypeError）', async () => {
    render(<TabPricing billing={undefined} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('正在读取价表…')).toBeTruthy()
  })
})

describe('SettingsSection', () => {
  it('渲染预算开关与常驻口径说明（不可关）', () => {
    const h = fakeScope(baseConfig({ budget: { enabled: true, monthlyCny: 100 } }), { writable: false })
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)
    // brief 原文是 `getByText(/计费口径/)`：`<h3>计费口径</h3>` 与常驻说明段都命中，getByText 抛
    // “Found multiple elements”。带冒号的正则只命中不可关的口径说明段（用例名要的正是它）。
    expect(screen.getByText(/计费口径：/)).toBeTruthy()
  })

  it('子代理开关往返：同时写宿主设置与视图 store（只写一处会与页面上的账打脸）', async () => {
    const h = fakeScope(baseConfig())
    const store = createBillingStore({ open: true })
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={store} />)

    const box = screen.getByRole('checkbox', { name: /统计包含子代理会话/ }) as HTMLInputElement
    expect(box.checked).toBe(true)
    await act(async () => { fireEvent.click(box) })

    expect(h.writes).toContainEqual({
      field: 'display', value: { showUnpricedWarning: true, includeSubagents: false },
    })
    expect(store.includeSubagents).toBe(false)
    // 快照折回后复选框必须跟着变（不是只在本地 state 里翻）。
    expect((screen.getByRole('checkbox', { name: /统计包含子代理会话/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('预算开关往返：写 budget.enabled 并随快照回弹', async () => {
    const h = fakeScope(baseConfig())
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)

    const box = screen.getByRole('checkbox', { name: /启用预算提醒/ }) as HTMLInputElement
    expect(box.checked).toBe(false)
    await act(async () => { fireEvent.click(box) })

    expect(h.writes).toContainEqual({ field: 'budget', value: { enabled: true, monthlyCny: 100 } })
    expect((screen.getByRole('checkbox', { name: /启用预算提醒/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('预算金额未配置时显示占位而不是「0 元」', () => {
    const h = fakeScope({ ...baseConfig(), budget: { monthlyCny: undefined } as never })
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)
    expect(screen.getByText(/预算金额：—/)).toBeTruthy()
    expect(screen.queryByText(/预算金额：0 元/)).toBeNull()
  })

  it('远程面缺席时 effect 早退（不抛 TypeError）', async () => {
    const h = fakeScope(baseConfig())
    render(<SettingsSection billing={undefined} scope={h.scope} store={createBillingStore({ open: true })} />)
    // 状态区停在 0 行（status 未到），页面本身必须正常渲染。
    expect(screen.getByText(/账本 0 行/)).toBeTruthy()
    expect(screen.getByText(/计费口径：/)).toBeTruthy()
  })
})
