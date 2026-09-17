// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackfillLedgerNote, BackfillNotice } from '../src/client/views/backfill-notice.tsx'
import { Dashboard } from '../src/client/views/dashboard.tsx'
import { Sparkline, BarChart } from '../src/client/views/chart.tsx'
import { DataTable } from '../src/client/views/components/data-table.tsx'
import type { TableColumn } from '../src/client/views/components/data-table.tsx'
import { createBillingStore } from '../src/client/core/store.ts'
import type { UsageBillingRemote } from '../src/client/core/remote.ts'
import type { DailyPoint, Overview } from '../src/view.ts'
import type { AliasInput, CustomPriceInput, PriceEntry } from '../src/types.ts'
import { TabOverview } from '../src/client/views/tab-overview.tsx'
import { TabTrend } from '../src/client/views/tab-trend.tsx'
import { TabHeatmap } from '../src/client/views/tab-heatmap.tsx'
import { TabDetail } from '../src/client/views/tab-detail.tsx'
import { TabPricing } from '../src/client/views/tab-pricing.tsx'
import { SettingsSection } from '../src/client/views/settings-section.tsx'
import type { BillingScope } from '../src/client/core/config.ts'
import { evaluateBudget } from '../src/budget.ts'
import type { RangeKind } from '../src/time.ts'
import { baseConfig, fakeScope } from './fake-scope.ts'
import { NON_FINITE_PLACEHOLDER } from '../src/client/core/format.ts'

// 宿主 UI 原语是浏览器包（lib 里 import 了只在宿主 app 打包时才解析得到的依赖），
// Node 里直接 import 会炸 —— 换成透传替身，与 plugin-memory / plugin-daily-log 同一姿态。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => await import('./primitives-stub.tsx'))

// 本仓没有 vitest 配置、`globals` 关闭，RTL 的自动 cleanup 依赖全局 afterEach 因而失效；
// 不显式清理的话上一用例的 DOM 会留下（表现就是 getByRole('button') 命中多个）。
afterEach(() => { cleanup() })

describe('BackfillNotice', () => {
  it('未关闭时显示提示，含估算起点时刻，并如实说明它来自本次宿主加载而非首次安装', () => {
    const { baseElement: container } = render(
      <BackfillNotice installAt={Date.UTC(2026, 8, 16, 6, 0)} dismissed={false} writable onDismiss={() => {}} />,
    )
    expect(container.textContent).toContain('安装前的历史用量按')
    expect(container.textContent).toContain('安装时点的价表估算')
    expect(container.textContent).toContain('本次宿主加载')
    // N-2：这个值每个宿主进程重新取一次，措辞不能说成「插件安装前」。
    expect(container.textContent).not.toContain('插件安装前')
  })

  it('已关闭时完全不渲染', () => {
    const { baseElement: container } = render(<BackfillNotice installAt={1} dismissed writable onDismiss={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('点关闭调用 onDismiss', () => {
    const onDismiss = vi.fn()
    render(<BackfillNotice installAt={1} dismissed={false} writable onDismiss={onDismiss} />)
    screen.getByRole('button').click()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('只读时「知道了」被禁用，可写时可用（不留按了没反应的按钮）', () => {
    const ro = render(<BackfillNotice installAt={1} dismissed={false} writable={false} onDismiss={() => {}} />)
    const roButton = ro.container.querySelector('button') as HTMLButtonElement
    expect(roButton.disabled).toBe(true)
    expect(roButton.textContent).toBe('知道了')

    const rw = render(<BackfillNotice installAt={1} dismissed={false} writable onDismiss={() => {}} />)
    expect((rw.container.querySelector('button') as HTMLButtonElement).disabled).toBe(false)
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
  byWorkspace: async () => ({ ok: true, value: { workspaces: [], hasBackfilled: false, unpricedModels: [] } }),
  pricing: async () => ({ ok: true, value: { entries: {}, usdToCny: 7.1, usdToCnySource: 'default', snapshotId: 'snap-install', customKeys: [] } }),
  // 安装时刻只从 status() 来（设置命名空间里没有这个字段）：默认给一个真实时刻，
  // 回填提示条才会渲染；需要「取不到」的用例各自覆盖它。
  status: async () => ({ ok: true, value: { installAt: 1_700_000_000_000, rows: 0, sessions: 0, snapshots: 0 } }),
  // 费率页挂载即读别名表（手工别名的展示层合并），所有用它的假件都要能应答。
  aliasList: async () => ({ ok: true, value: { aliases: [] } }),
  setAlias: async () => ({ ok: true, value: { ok: true } }),
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

/**
 * TabOverview 需要设置面（`display.showUnpricedWarning`）；默认给一份缺省设置。
 * 默认面必须是**模块级常量**：在 render 里现造会让 `getSnapshot()` 每次返回新对象，
 * `useSyncExternalStore` 每帧都判定「变了」而无限重渲染。
 */
const DEFAULT_TAB_SCOPE = fakeScope(baseConfig()).scope
const Tab = (props: {
  billing: UsageBillingRemote | undefined
  store: ReturnType<typeof createBillingStore>
  scope?: BillingScope
}) => (
  <TabOverview billing={props.billing} store={props.store} scope={props.scope ?? DEFAULT_TAB_SCOPE} />
)

describe('Sparkline / BarChart', () => {
  it('空数据不渲染 svg 内部元素也不抛', () => {
    const { baseElement: container } = render(<Sparkline values={[]} />)
    expect(container.querySelector('polyline')).toBeNull()
  })
  it('柱状图每根柱都是 rect，tooltip 由调用方格式化（不打印原始浮点）', () => {
    const { baseElement: container } = render(
      <BarChart values={[1, 2, 3]} labels={['a', 'b', 'c']} width={90} height={30}
        formatValue={(n) => `¥${n.toFixed(2)}`} />,
    )
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    expect(container.querySelector('title')!.textContent).toBe('a: ¥1.00')
  })
})

describe('Dashboard', () => {
  it('弹窗关闭时不渲染面板', () => {
    const store = createBillingStore({ open: false })
    const { baseElement: container } = render(dash({ billing: noopRemote(), store }))
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

  it('分区导航是下划线式页签（不是描边盒子），active 恰好一个', () => {
    const store = createBillingStore({ open: true })
    render(dash({ billing: noopRemote(), store }))
    const nav = document.querySelector('[data-dsh-ub-tabs]')!
    expect(nav.className).toContain('ub-tabnav')
    const tabs = Array.from(nav.querySelectorAll('button'))
    expect(tabs.map((t) => t.textContent)).toEqual(['概览', '趋势', '热力图', '明细', '费率'])
    // 首帧停在概览：它是唯一带 ub-tab-active + aria-current 的那个。
    expect(tabs[0]!.className).toBe('ub-tab ub-tab-active')
    expect(tabs[0]!.getAttribute('aria-current')).toBe('page')
    expect(tabs[1]!.className).toBe('ub-tab')
    expect(tabs[1]!.getAttribute('aria-current')).toBeNull()

    fireEvent.click(tabs[1]!)
    const after = Array.from(document.querySelectorAll('[data-dsh-ub-tabs] button'))
    expect(after.filter((t) => t.className.split(' ').includes('ub-tab-active'))).toHaveLength(1)
    expect(after[1]!.className).toBe('ub-tab ub-tab-active')
  })

  it('用宿主 Modal：role=dialog + aria-modal + 可访问的关闭按钮（不再自绘遮罩）', async () => {
    const store = createBillingStore({ open: true })
    render(dash({ billing: noopRemote(), store }))
    const dialog = screen.getByRole('dialog', { name: '计费' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy()
    // 弹窗是 portal 到 body 的：它不在 render 返回的 container 里（真环境同样如此）。
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '关闭' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.getSnapshot().open).toBe(false)
  })

  it('远程面缺席（首帧 $mount 未完成）时每个 tab 都不抛', async () => {
    const store = createBillingStore({ open: true })
    const { baseElement: container } = render(dash({ billing: undefined, store }))
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
    const { baseElement: container, unmount } = render(<Dashboard billing={noopRemote()} store={store} scope={h.scope} />)
    // 安装时刻来自 status()（异步），提示条在 status 落地后才出现。
    await waitFor(() => { expect(container.querySelector('[data-dsh-ub-notice]')).toBeTruthy() })

    const dismiss = container.querySelector('[data-dsh-ub-notice] button') as HTMLElement
    await act(async () => { fireEvent.click(dismiss) })
    expect(h.writes).toContainEqual({
      field: 'notices', value: { backfillDismissed: true, budgetNotified: {} },
    })
    expect(container.querySelector('[data-dsh-ub-notice]')).toBeNull()

    // 一次性：同一份宿主设置（已 dismissed）重新挂载也不再出现 —— 不是本地一次性 state。
    unmount()
    const again = render(<Dashboard billing={noopRemote()} store={createBillingStore({ open: true })} scope={h.scope} />)
    await act(async () => { await Promise.resolve() })
    expect(again.baseElement.querySelector('[data-dsh-ub-notice]')).toBeNull()
  })

  it('只读 scope：提示条的「知道了」被禁用，且点了不会写宿主（不是写了静默失败）', async () => {
    const store = createBillingStore({ open: true })
    const h = fakeScope(baseConfig(), { writable: false })
    const { baseElement: container } = render(<Dashboard billing={noopRemote()} store={store} scope={h.scope} />)
    await waitFor(() => { expect(container.querySelector('[data-dsh-ub-notice] button')).toBeTruthy() })
    const dismiss = container.querySelector('[data-dsh-ub-notice] button') as HTMLButtonElement
    // 门控与设置页的三个开关同一姿态（那里是 disabled={!settings.writable}）。
    expect(dismiss.disabled).toBe(true)

    await act(async () => { fireEvent.click(dismiss) })
    expect(h.writes).toEqual([])
    // 提示条必须还在：不是本地藏起来，而是宿主根本没被写。
    expect(container.querySelector('[data-dsh-ub-notice]')).toBeTruthy()
  })

  it('安装时刻取不到（status 失败 / installAt 非正）就不渲染提示条：不报假日期', async () => {
    const h = fakeScope(baseConfig())
    const store = createBillingStore({ open: true })
    // 设置快照里**没有** installAt 这个字段（宿主也从没写过它）—— 旧实现读 cfg.installAt 时
    // 把这一条提示条永久关掉；若哪天又把它当成 0 交给格式化，这里会看到 1970。
    const down = render(<Dashboard billing={noopRemote({
      status: async () => { throw new Error('wire down') },
    } as never)} store={store} scope={h.scope} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(down.baseElement.querySelector('[data-dsh-ub-notice]')).toBeNull()
    expect(down.baseElement.textContent).not.toContain('1970')

    const zero = render(<Dashboard billing={noopRemote({
      status: async () => ({ ok: true, value: { installAt: 0, rows: 0, sessions: 0, snapshots: 0 } }),
    } as never)} store={store} scope={h.scope} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(zero.baseElement.querySelector('[data-dsh-ub-notice]')).toBeNull()
    expect(zero.baseElement.textContent).not.toContain('1970')
  })

  /**
   * 预算跨档提醒（spec §6.7）：跨 50/80/100% 各提醒一次，按「月份 + 档位」去重。
   * 判定用的是 `overview('month')`（月度口径，不被概览页的范围窗口带偏），
   * 落盘走 notices.budgetNotified（与回填提示条的关闭同一条写路径）。
   */
  const budgetRemote = (totalCny: number) => noopRemote({
    overview: async () => ({ ok: true, value: {
      overview: { ...emptyOverview, totalCny },
      todayKey: '2026-09-16',
      budget: { enabled: true, monthlyCny: 100 },
    } }),
  } as never)

  it('跨档时弹窗里一次性提醒，并把「已提醒」按「月份 + 档位」写回宿主 notices', async () => {
    const h = fakeScope(baseConfig({ budget: { enabled: true, monthlyCny: 100 } }))
    const { baseElement: container } = render(
      <Dashboard billing={budgetRemote(82)} store={createBillingStore({ open: true })} scope={h.scope} />,
    )
    expect(await screen.findByText(/跨过 80% 档/)).toBeTruthy()
    expect(container.querySelector('[data-dsh-ub-budget-notice]')).toBeTruthy()
    // 只写当前月的那一档 + 保留 notices 的其他字段（不是整段覆盖成空对象）。
    expect(h.writes).toContainEqual({
      field: 'notices', value: { backfillDismissed: false, budgetNotified: { '2026-09': '2' } },
    })
    // 本地「知道了」只收起本次提示；「每月每档一次」由已落盘的标记保证。
    fireEvent.click(container.querySelector('[data-dsh-ub-budget-notice] button') as HTMLElement)
    expect(container.querySelector('[data-dsh-ub-budget-notice]')).toBeNull()
  })

  /**
   * N-1：`notices` 的两个写者（关闭回填提示条 / 预算跨档标记）不能互相覆盖。
   *
   * `settle: true` 让「跨档写已排队、还没折回快照」这个窗口可复现：此时点「知道了」，
   * 关闭写入读到的基数里还没有 `budgetNotified`。旧实现用本次渲染捕获的 `cfg.notices` 展开，
   * 会把刚写的 `'2026-09': '2'` 整段还原成 `{}`（同一档位下次打开再提醒）；
   * 现在两个写者共用一条写缝（写入时刻现取快照 + 写队列串行），两个子键都必须留下。
   */
  it('两个写者交错：关闭回填提示条不会把已落盘的预算跨档标记覆盖掉', async () => {
    const h = fakeScope(baseConfig({ budget: { enabled: true, monthlyCny: 100 } }), { settle: true })
    const { baseElement: container } = render(
      <Dashboard billing={budgetRemote(82)} store={createBillingStore({ open: true })} scope={h.scope} />,
    )
    // 跨档写已排队（尚未结算），提示条还在屏幕上。
    await screen.findByText(/跨过 80% 档/)
    await waitFor(() => { expect(h.writes).toHaveLength(1) })

    // 结算窗口内点「知道了」：这一次写入必须等前一次落地后再现取快照。
    await act(async () => { fireEvent.click(container.querySelector('[data-dsh-ub-notice] button') as HTMLElement) })
    await act(async () => { await h.settle(0) })
    await waitFor(() => { expect(h.writes).toHaveLength(2) })

    const last = h.writes[1]!.value as { backfillDismissed: boolean; budgetNotified: Record<string, string> }
    expect(last.backfillDismissed).toBe(true)
    expect(last.budgetNotified).toEqual({ '2026-09': '2' })
    await act(async () => { await h.settle(1) })
    expect(h.value().notices).toEqual({ backfillDismissed: true, budgetNotified: { '2026-09': '2' } })
  })

  it('同一「月份 + 档位」已提醒过：不再提醒，也不再写宿主', async () => {
    const h = fakeScope(baseConfig({
      budget: { enabled: true, monthlyCny: 100 },
      notices: { backfillDismissed: true, budgetNotified: { '2026-09': '2' } },
    }))
    const { baseElement: container } = render(
      <Dashboard billing={budgetRemote(90)} store={createBillingStore({ open: true })} scope={h.scope} />,
    )
    await screen.findByText('¥90.00')
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-dsh-ub-budget-notice]')).toBeNull()
    expect(h.writes).toEqual([])
  })

  it('未跨档（低于 50%）不提醒', async () => {
    const h = fakeScope(baseConfig({ budget: { enabled: true, monthlyCny: 100 } }))
    const { baseElement: container } = render(
      <Dashboard billing={budgetRemote(10)} store={createBillingStore({ open: true })} scope={h.scope} />,
    )
    await screen.findByText('¥10.00')
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-dsh-ub-budget-notice]')).toBeNull()
    expect(h.writes).toEqual([])
  })

  it('面板没打开时不判定也不落盘（没被看到的提醒不算「已提醒」）', async () => {
    const h = fakeScope(baseConfig({ budget: { enabled: true, monthlyCny: 100 } }))
    const ranges: string[] = []
    const billing = noopRemote({
      overview: async (rangeKind: RangeKind) => {
        ranges.push(rangeKind)
        return { ok: true, value: {
          overview: { ...emptyOverview, totalCny: 82 }, todayKey: '2026-09-16',
          budget: { enabled: true, monthlyCny: 100 },
        } }
      },
    } as never)
    const { baseElement: container } = render(
      <Dashboard billing={billing} store={createBillingStore({ open: false })} scope={h.scope} />,
    )
    await act(async () => { await Promise.resolve() })
    expect(ranges).toEqual([])
    expect(h.writes).toEqual([])
    expect(container.querySelector('[data-dsh-ub-panel]')).toBeNull()
  })
})

const overviewRemote = (over: Record<string, unknown>, dailyOver: Record<string, unknown> = {}) => noopRemote({
  overview: async () => ({ ok: true, value: { overview: { totalCny: 42, todayCny: 3, weekCny: 12, avgDailyCny: 6, cacheHitRate: 0.5, calls: 9, unpricedModels: ['x/mystery'], unpricedRows: 1, hasBackfilled: true, ...over }, todayKey: '2026-09-16', budget: { enabled: true, monthlyCny: 100 } } }),
  daily: async () => ({ ok: true, value: { days: [{ day: '2026-09-15', costCny: 1, input: 10, cacheRead: 0, cacheWrite: 0, output: 5, calls: 1 }], hasBackfilled: true, unpricedModels: [], ...dailyOver } }),
} as never)

describe('TabOverview', () => {
  it('Hero 显示本月费用与今日，未收录有提示，回填有估算角标', async () => {
    render(<Tab billing={overviewRemote({})} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('¥42.00')).toBeTruthy()
    // brief 原文是 `getByText(/未收录/)`：KPI 标签「未收录模型」、KPI 值「1 未收录」与下方提示条
    // 三处都命中该正则，getByText 会抛 “Found multiple elements”。实现保持 brief 逐字不变，
    // 这里改为分别断言计数徽标与提示条（都仍会失败，不是空断言）。
    expect(screen.getByText('1 未收录')).toBeTruthy()
    expect(screen.getByText(/条记录涉及/)).toBeTruthy()
    expect(screen.getByText(/估算/)).toBeTruthy()
  })

  it('预算超支时进度条 level=over', async () => {
    // 预算条吃的是**当月切片**（monthSpend），不是累计金额：fake 的 daily 必须给出当月金额。
    const { baseElement: container } = render(<Tab
      billing={overviewRemote({ totalCny: 150 }, {
        days: [{ day: '2026-09-15', costCny: 150, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 1 }],
      })}
      store={createBillingStore({ open: true })} />)
    // 不能用 findByText('¥150.00')：它会同时命中「累计费用」与「区间合计」两处。
    await screen.findByText(/本月预算/)
    expect(container.querySelector('[data-dsh-ub-bar]')!.getAttribute('data-level')).toBe('over')
  })

  it('预算条按当月切片：上个月的金额不参与月度预算（累计金额也不参与）', async () => {
    const { baseElement: container } = render(<Tab
      billing={overviewRemote({ totalCny: 150 }, {
        days: [
          // 上个月花了 150（累计金额因此非零），当月只花了 1 —— 月度预算必须只看当月。
          { day: '2026-08-31', costCny: 150, input: 1, cacheRead: 0, cacheWrite: 0, output: 1, calls: 1 },
          { day: '2026-09-15', costCny: 1, input: 1, cacheRead: 0, cacheWrite: 0, output: 1, calls: 1 },
        ],
      })}
      store={createBillingStore({ open: true })} />)
    await screen.findByText(/本月预算/)
    // 当月 1 / 预算 100 → 1%（若误用累计 150 → 150% 就直接超支了）。
    expect(container.textContent).toContain('已用 1%')
    expect(container.querySelector('[data-dsh-ub-bar]')!.getAttribute('data-level')).toBe('ok')
  })

  it('未收录提示被关掉时不显示', async () => {
    render(<Tab billing={overviewRemote({ unpricedModels: [] })} store={createBillingStore({ open: true })} />)
    await screen.findByText('¥42.00')
    // brief 原文是 `queryByText(/未收录/)`：常驻 KPI 标签「未收录模型」恒命中，永远不为 null；
    // 「关掉」的是未收录提示条，所以按提示条断言。
    expect(screen.queryByText(/条记录涉及/)).toBeNull()
  })

  it('display.showUnpricedWarning 关掉时提示条消失，但计数与徽标（事实）照旧', async () => {
    // 该设置此前只在 schema 里躺着（没有任何 UI、也没有任何读取方）：关掉它必须真的关掉
    // 那条解释性文案，而未收录的**事实**（「1 未收录」与 KPI 计数）永远保留。
    const h = fakeScope(baseConfig({ display: { showUnpricedWarning: false, includeSubagents: true } }))
    render(<Tab billing={overviewRemote({})} store={createBillingStore({ open: true })} scope={h.scope} />)
    await screen.findByText('¥42.00')
    expect(screen.queryByText(/条记录涉及/)).toBeNull()
    expect(screen.getByText('1 未收录')).toBeTruthy()
  })

  it('display.showUnpricedWarning 打开（缺省）时提示条照常显示', async () => {
    render(<Tab billing={overviewRemote({})} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/条记录涉及/)).toBeTruthy()
  })

  it('整份账一行都没定价：所有金额槽位显示占位，绝不显示 ¥0.00', async () => {
    const { baseElement: container } = render(<Tab
      billing={overviewRemote({ totalCny: 0, todayCny: 0, weekCny: 0, avgDailyCny: 0, calls: 3, unpricedModels: ['x/mystery'], unpricedRows: 3 })}
      store={createBillingStore({ open: true })} />)
    await waitFor(() => {
      expect(container.querySelectorAll('[data-dsh-ub-money]').length).toBeGreaterThan(0)
    })
    const slots = [...container.querySelectorAll('[data-dsh-ub-money]')].map((el) => el.textContent)
    expect(slots.every((text) => text === '—')).toBe(true)
    expect(container.textContent).not.toContain('¥0.00')
    // 未收录徽标与计数不变：占位只换金额，不吞披露。
    expect(screen.getByText('1 未收录')).toBeTruthy()
  })

  it('主数字是 Token：金额未知也不影响它（Token 是观测事实，不是未知）', async () => {
    const { baseElement: container } = render(<Tab
      billing={overviewRemote({ totalCny: 0, todayCny: 0, unpricedModels: ['x/mystery'], unpricedRows: 3 })}
      store={createBillingStore({ open: true })} />)
    // fake 的 daily 是 10 input + 5 output → 累计 15 个 token。
    await waitFor(() => {
      expect(container.querySelector('[data-dsh-ub-hero]')?.textContent).toBe('15')
    })
  })

  it('真实零（无未收录模型）时金额槽位保留 ¥0.00 —— 占位不能吞掉合法结果', async () => {
    const { baseElement: container } = render(<Tab
      billing={overviewRemote({ totalCny: 0, todayCny: 0, weekCny: 0, avgDailyCny: 0, unpricedModels: [], unpricedRows: 0 }, {
        // 真实零：overview 与 daily 必须是同一个事实（否则区间合计会和累计金额打架）。
        days: [{ day: '2026-09-15', costCny: 0, input: 10, cacheRead: 0, cacheWrite: 0, output: 5, calls: 1 }],
      })}
      store={createBillingStore({ open: true })} />)
    await waitFor(() => {
      expect(container.querySelectorAll('[data-dsh-ub-money]').length).toBeGreaterThan(0)
    })
    // 累计费用 / 今日费用 / 区间合计 三处都是真实零。
    const slots = [...container.querySelectorAll('[data-dsh-ub-money]')].map((el) => el.textContent)
    expect(slots).toEqual(['¥0.00', '¥0.00', '¥0.00'])
  })

  it('今日卡与累计卡同一占位口径：未知写「—」，真实零写 ¥0.00', async () => {
    // 未知（整份账未定价）：今日也写占位 —— 子集里的 0 同样是未知，不是真实零。
    const unknown = render(<Tab
      billing={overviewRemote({ totalCny: 0, todayCny: 0, calls: 3, unpricedModels: ['x/mystery'], unpricedRows: 3 })}
      store={createBillingStore({ open: true })} />)
    const unknownSub = (await screen.findByText(/今日费用/)).textContent ?? ''
    expect(unknownSub).toContain('—')
    expect(unknownSub).not.toContain('¥0.00')
    unknown.unmount()

    // 真实零（无未收录模型）：同一处占位不能吞掉合法结果。
    render(<Tab
      billing={overviewRemote({ totalCny: 0, todayCny: 0, calls: 0, unpricedModels: [], unpricedRows: 0 })}
      store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/今日费用/)).toBeTruthy()
    expect(screen.getByText(/今日费用/).textContent).toContain('¥0.00')
  })

  it('回填标记缺席（旧 host / 宽松 codec 透传）按 present 处理：估算角标照常显示', async () => {
    // 与入口卡、明细、趋势、热力图同一个保守 helper；直接读 overview.hasBackfilled 会把
    // 「标记缺席」当成「没有回填」而少披露。
    render(<Tab billing={overviewRemote({ hasBackfilled: undefined })} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/含安装前估算/)).toBeTruthy()
  })

  it('host 返回 ok:false 时停在读取占位并留日志，绝不落到 ¥0.00', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      render(<Tab
        billing={noopRemote({ overview: async () => ({ ok: false, error: { message: 'host down' } }) as never } as never)}
        store={createBillingStore({ open: true })} />)
      expect(await screen.findByText('正在读取用量…')).toBeTruthy()
      expect(screen.queryByText('¥0.00')).toBeNull()
      await waitFor(() => {
        expect(warn).toHaveBeenCalledWith('[usage-billing] 概览取数失败', expect.anything())
      })
    } finally { warn.mockRestore() }
  })

  it('取数 reject 时停在读取占位并留日志（不是 unhandled rejection）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      render(<Tab
        billing={noopRemote({ overview: async () => { throw new Error('wire down') } } as never)}
        store={createBillingStore({ open: true })} />)
      expect(await screen.findByText('正在读取用量…')).toBeTruthy()
      expect(screen.queryByText('¥0.00')).toBeNull()
      await waitFor(() => {
        expect(warn).toHaveBeenCalledWith('[usage-billing] 概览通道异常', expect.anything())
      })
    } finally { warn.mockRestore() }
  })

  it('远程面缺席时 effect 早退（不抛 TypeError）', async () => {
    render(<Tab billing={undefined} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText('正在读取用量…')).toBeTruthy()
  })
})

describe('TabTrend', () => {
  it('费用/Token 指示可切换且渲染柱状图', async () => {
    const store = createBillingStore({ open: true })
    const { baseElement: container } = render(<TabTrend billing={overviewRemote({})} store={store} />)
    // echarts 在 jsdom 里没有 canvas 可画，会按设计降级到手绘 SVG 柱状图
    // （trend-chart.tsx），所以这条断言跑的是那条真实降级路径。
    await screen.findByRole('img', { name: '柱状图' }, { timeout: 5000 })
    await waitFor(() => { expect(container.querySelectorAll('rect').length).toBeGreaterThan(0) })
  })

  it('evaluateBudget 与 UI 档位一致（同一份纯函数，不重复实现）', () => {
    expect(evaluateBudget({ spentCny: 150, monthlyCny: 100, enabled: true, notified: {}, monthKey: '2026-09' }).level).toBe('over')
  })

  it('柱状图 tooltip 走 format.ts：不打印原始浮点，Token 模式走 formatInt', async () => {
    const store = createBillingStore({ open: true })
    const billing = noopRemote({
      daily: async () => ({ ok: true, value: {
        days: [{ day: '2026-09-15', costCny: 1234.5678901234, input: 1234567, cacheRead: 0, cacheWrite: 0, output: 0, calls: 1 }],
        hasBackfilled: false, unpricedModels: [],
      } }),
    } as never)
    const { baseElement: container } = render(<TabTrend billing={billing} store={store} />)
    await screen.findByRole('img', { name: '柱状图' }, { timeout: 5000 })
    await waitFor(() => { expect(container.querySelector('title')).not.toBeNull() })
    const costTitle = container.querySelector('title')!.textContent ?? ''
    expect(costTitle).toContain('¥1,234.57')
    expect(costTitle).not.toContain('1234.5678901234')

    await act(async () => { screen.getByText('Token').click() })
    expect(container.querySelector('title')!.textContent).toContain('1,234,567')
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
    await screen.findByRole('img', { name: '柱状图' }, { timeout: 5000 })
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
    // 逐日表里的费用列与合计同一口径：整份账未定价时是占位。
    const row = screen.getAllByRole('row').find((r) => (r.textContent ?? '').includes('2026-09-15'))
    expect(row?.textContent).toContain('—')
  })

  it('真实零（无未收录模型）时合计保留 ¥0.00', async () => {
    const zeroDay: DailyPoint = { day: '2026-09-15', costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 }
    const billing = noopRemote({
      daily: async () => ({ ok: true, value: { days: [zeroDay], hasBackfilled: false, unpricedModels: [] } }),
    } as never)
    render(<TabTrend billing={billing} store={createBillingStore({ open: true })} />)
    await waitFor(() => { expect(screen.getByText(/合计/).textContent).toContain('¥0.00') })
  })

  it('取数 reject 时停在读取占位并留日志（不是 unhandled rejection）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      render(<TabTrend billing={noopRemote({ daily: async () => { throw new Error('wire down') } } as never)}
        store={createBillingStore({ open: true })} />)
      expect(await screen.findByText('正在读取用量…')).toBeTruthy()
      expect(screen.queryByText('¥0.00')).toBeNull()
      await waitFor(() => {
        expect(warn).toHaveBeenCalledWith('[usage-billing] 趋势通道异常', expect.anything())
      })
    } finally { warn.mockRestore() }
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
    { key: 'deepseek-v4-flash', providers: ['deepseek'], provider: 'deepseek', model: 'deepseek-v4-flash', rawModels: ['deepseek-v4-flash'],
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
    { key: 'deepseek-v4-flash', providers: ['deepseek'], provider: 'deepseek', model: 'deepseek-v4-flash',
      rawModels: ['deepseek-v4-flash', 'deepseek-v4-flash-20260518'],
      input: 10, cacheRead: 0, cacheWrite: 0, output: 5, reasoning: 0, costCny: 7, priced: true, mixedRate: true, calls: 2 },
    { key: 'ghost-model', providers: ['openai'], provider: 'openai', model: 'ghost-model', rawModels: ['ghost-model'],
      input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, costCny: 0, priced: false, mixedRate: false, calls: 1 },
  ], hasBackfilled: true, unpricedModels: ['openai/ghost-model'] } }),
} as never)

/**
 * 整份账一行都没定价的明细 fixture：工作区 / 会话金额都是 0，而 `byWorkspace` **自己带着**
 * `unpricedModels`。此前的明细把这份清单丢掉、金额列直接写 ¥0.00 —— 读起来就是「免费」。
 */
const detailUnpricedRemote = (unpricedModels: string[] = ['openai/ghost-model']) => noopRemote({
  byWorkspace: async () => ({ ok: true, value: {
    workspaces: [
      { cwd: 'D:\\codes\\demo', calls: 2, costCny: 0, sessions: [
        { sessionId: 's1', day: '2026-09-16', calls: 2, costCny: 0, lastTime: 1, isSubagent: false },
      ] },
    ],
    hasBackfilled: false, unpricedModels,
  } }),
  byModel: async () => ({ ok: true, value: { models: unpricedModels.length === 0 ? [] : [
    { key: 'ghost-model', providers: ['openai'], provider: 'openai', model: 'ghost-model', rawModels: ['ghost-model'],
      input: 10, cacheRead: 0, cacheWrite: 0, output: 5, reasoning: 0, costCny: 0, priced: false, mixedRate: false, calls: 2 },
  ], hasBackfilled: false, unpricedModels } }),
} as never)

describe('TabHeatmap', () => {
  it('渲染 5 档热力格，活跃天与总天数是文字', async () => {
    const { baseElement: container } = render(<TabHeatmap billing={heatRemote()} store={createBillingStore({ open: true })} />)
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
    const { baseElement: container } = render(<TabHeatmap billing={billing} store={createBillingStore({ open: true })} />)
    await screen.findByText(/活跃/)
    const titles = [...container.querySelectorAll('[data-dsh-ub-heat] > span')].map((s) => s.getAttribute('title') ?? '')
    expect(titles.join('|')).toContain('—')
    expect(titles.join('|')).not.toContain('¥0.00')
  })
  it('取数 reject 时停在读取占位并留日志（不是 unhandled rejection）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      render(<TabHeatmap billing={noopRemote({ daily: async () => { throw new Error('wire down') } } as never)}
        store={createBillingStore({ open: true })} />)
      expect(await screen.findByText('正在读取用量…')).toBeTruthy()
      expect(screen.queryByText('¥0.00')).toBeNull()
      await waitFor(() => {
        expect(warn).toHaveBeenCalledWith('[usage-billing] 热力图通道异常', expect.anything())
      })
    } finally { warn.mockRestore() }
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

  it('整份账一行都没定价：工作区 / 会话金额列写「未收录」而不是 ¥0.00', async () => {
    const { baseElement: container } = render(<TabDetail billing={detailUnpricedRemote()} store={createBillingStore({ open: true })} />)
    const workspace = await screen.findByRole('button', { name: /D:\\codes\\demo/ })
    // 工作区行已经是「未收录」而不是 ¥0.00；展开到会话行同样。
    expect(workspace.textContent).toContain('未收录')
    workspace.click()
    expect(await screen.findByText(/s1/)).toBeTruthy()
    expect(container.textContent).not.toContain('¥0.00')
    expect(screen.getAllByText('未收录').length).toBeGreaterThanOrEqual(2)
  })

  it('真实零（响应没带未收录清单）：工作区金额列保留 ¥0.00 —— 同一处占位不能吞掉合法结果', async () => {
    render(<TabDetail billing={detailUnpricedRemote([])} store={createBillingStore({ open: true })} />)
    const workspace = await screen.findByRole('button', { name: /D:\\codes\\demo/ })
    expect(workspace.textContent).toContain('¥0.00')
    expect(screen.queryByText('未收录')).toBeNull()
  })

  it('取数 reject 时停在读取占位并留日志（不是 unhandled rejection）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      render(<TabDetail
        billing={noopRemote({ byWorkspace: async () => { throw new Error('wire down') } } as never)}
        store={createBillingStore({ open: true })} />)
      expect(await screen.findByText('正在读取用量…')).toBeTruthy()
      expect(screen.queryByText('¥0.00')).toBeNull()
      await waitFor(() => {
        expect(warn).toHaveBeenCalledWith('[usage-billing] 明细通道异常', expect.anything())
      })
    } finally { warn.mockRestore() }
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
  const aliasCalls: AliasInput[] = []
  const norm = (s: string): string => s.trim().toLowerCase()
  let aliases: Array<{ provider: string; rawModel: string; canonicalModel: string }> = []
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
    aliasList: async () => ({ ok: true, value: { aliases: aliases.map((a) => ({ ...a })) } }),
    setAlias: async (input: AliasInput) => {
      aliasCalls.push(input)
      aliases = aliases.filter((a) => !(a.provider === norm(input.provider) && a.rawModel === input.rawModel.trim()))
      if (input.canonicalModel !== null) {
        aliases = [...aliases, {
          provider: norm(input.provider), rawModel: input.rawModel.trim(),
          canonicalModel: input.canonicalModel.trim(),
        }]
      }
      return { ok: true, value: { ok: true } }
    },
  } as never)
  return { billing, setCalls, removeCalls, aliasCalls, aliasesNow: () => aliases, entriesNow: () => entries }
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

  it('手工别名：绑定发的是完整 AliasInput，列表随 host 刷新', async () => {
    const h = pricingEditorRemote()
    render(<TabPricing billing={h.billing} store={createBillingStore({ open: true })} />)
    await screen.findByText(/deepseek-v4-flash/)

    fireEvent.change(screen.getByLabelText('原始 id'), { target: { value: 'deepseek/v4f-x' } })
    fireEvent.change(screen.getByLabelText('canonical 模型'), { target: { value: 'deepseek-v4-flash' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存别名' })) })

    expect(h.aliasCalls).toEqual([
      { provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: 'deepseek-v4-flash' },
    ])
    // 列表行（带空格的展示文本）——消息串「已绑定 deepseek/v4f-x → …」不带空格，两者不会混。
    expect(await screen.findByText('deepseek / v4f-x → deepseek-v4-flash')).toBeTruthy()
  })

  it('手工别名：解绑发 canonicalModel:null，列表里不再有它', async () => {
    const h = pricingEditorRemote()
    await h.billing.setAlias({ provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: 'deepseek-v4-flash' })
    render(<TabPricing billing={h.billing} store={createBillingStore({ open: true })} />)
    await screen.findByText('deepseek / v4f-x → deepseek-v4-flash')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '解绑 deepseek/v4f-x' })) })
    expect(h.aliasCalls.at(-1)).toEqual({ provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: null })
    await waitFor(() => { expect(screen.queryByText('deepseek / v4f-x → deepseek-v4-flash')).toBeNull() })
  })

  it('手工别名：残缺 key / 空 canonical 被拒绝，一次远程都不发', async () => {
    const h = pricingEditorRemote()
    render(<TabPricing billing={h.billing} store={createBillingStore({ open: true })} />)
    await screen.findByText(/deepseek-v4-flash/)

    fireEvent.change(screen.getByLabelText('原始 id'), { target: { value: 'no-slash' } })
    fireEvent.change(screen.getByLabelText('canonical 模型'), { target: { value: 'x' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存别名' })) })
    expect(await screen.findByText(/别名要写/)).toBeTruthy()
    expect(h.aliasCalls).toEqual([])
  })

  it('删除时宿主写入失败（RemoteResult ok:false）报宿主错误，不误报成「没有生效中的自定义价」', async () => {
    const key = 'deepseek/deepseek-v4-flash'
    const billing = noopRemote({
      pricing: async () => ({ ok: true, value: {
        entries: { [key]: { input: 9, cacheRead: 0.1, cacheWrite: 0.5, output: 2, currency: 'CNY' } },
        usdToCny: 7.1, usdToCnySource: 'default', snapshotId: 'snap-install', customKeys: [key],
      } }),
      removeCustomPrice: async () => ({ ok: false, error: { message: 'host is read-only' } }) as never,
    } as never)
    render(<TabPricing billing={billing} store={createBillingStore({ open: true })} />)
    await screen.findByText('自定义')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `删除 ${key}` })) })
    expect(screen.getByText('删除失败：host is read-only')).toBeTruthy()
    // 通道/宿主错误绝不能被说成「本来就没有自定义价」。
    expect(screen.queryByText(/没有生效中的自定义价/)).toBeNull()
  })

  it('删除时业务返回 ok:false（这个 key 本来就没有自定义价）才报「没有生效中的自定义价」', async () => {
    const key = 'deepseek/deepseek-v4-flash'
    const billing = noopRemote({
      pricing: async () => ({ ok: true, value: {
        entries: { [key]: { input: 9, cacheRead: 0.1, cacheWrite: 0.5, output: 2, currency: 'CNY' } },
        usdToCny: 7.1, usdToCnySource: 'default', snapshotId: 'snap-install', customKeys: [key],
      } }),
      removeCustomPrice: async () => ({ ok: true, value: { ok: false } }),
    } as never)
    render(<TabPricing billing={billing} store={createBillingStore({ open: true })} />)
    await screen.findByText('自定义')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `删除 ${key}` })) })
    expect(screen.getByText(`删除失败：${key} 没有生效中的自定义价`)).toBeTruthy()
    expect(screen.queryByText(/删除失败：host/)).toBeNull()
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

    const box = screen.getByRole('switch', { name: /统计包含子代理会话/ })
    expect(box.getAttribute('aria-checked')).toBe('true')
    await act(async () => { fireEvent.click(box) })

    expect(h.writes).toContainEqual({
      field: 'display', value: { showUnpricedWarning: true, includeSubagents: false },
    })
    expect(store.includeSubagents).toBe(false)
    // 快照折回后开关必须跟着变（不是只在本地 state 里翻）。
    expect(screen.getByRole('switch', { name: /统计包含子代理会话/ }).getAttribute('aria-checked')).toBe('false')
  })

  it('未收录提示条开关往返：写 display.showUnpricedWarning 并随快照回弹', async () => {
    const h = fakeScope(baseConfig())
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)

    const box = screen.getByRole('switch', { name: /未收录模型/ })
    expect(box.getAttribute('aria-checked')).toBe('true')
    await act(async () => { fireEvent.click(box) })

    expect(h.writes).toContainEqual({
      field: 'display', value: { showUnpricedWarning: false, includeSubagents: true },
    })
    // 快照折回后开关必须跟着变（不是只在本地 state 里翻）。
    expect(screen.getByRole('switch', { name: /未收录模型/ }).getAttribute('aria-checked')).toBe('false')
  })

  it('预算开关往返：写 budget.enabled 并随快照回弹', async () => {
    const h = fakeScope(baseConfig())
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)

    const box = screen.getByRole('switch', { name: /启用预算提醒/ })
    expect(box.getAttribute('aria-checked')).toBe('false')
    await act(async () => { fireEvent.click(box) })

    expect(h.writes).toContainEqual({ field: 'budget', value: { enabled: true, monthlyCny: 100 } })
    expect(screen.getByRole('switch', { name: /启用预算提醒/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('预算金额可编辑：失焦提交写 budget.monthlyCny（保留 enabled），显示随快照回弹', async () => {
    const h = fakeScope(baseConfig({ budget: { enabled: true, monthlyCny: 100 } }))
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)

    const amount = (): HTMLInputElement => screen.getByLabelText(/月度预算/) as HTMLInputElement
    expect(amount().value).toBe('100')

    await act(async () => { fireEvent.change(amount(), { target: { value: '300' } }) })
    await act(async () => { fireEvent.blur(amount()) })

    expect(h.writes).toContainEqual({ field: 'budget', value: { enabled: true, monthlyCny: 300 } })
    expect(amount().value).toBe('300')
  })

  it('预算金额回车即提交，不必先点走焦点', async () => {
    const h = fakeScope(baseConfig())
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)

    const amount = screen.getByLabelText(/月度预算/) as HTMLInputElement
    await act(async () => { fireEvent.change(amount, { target: { value: '250.5' } }) })
    await act(async () => { fireEvent.keyDown(amount, { key: 'Enter' }) })

    expect(h.writes).toContainEqual({ field: 'budget', value: { enabled: false, monthlyCny: 250.5 } })
  })

  it('预算金额非法输入（空 / 0 / 负数 / 非数字）一律不落盘，显示回弹到快照真值', async () => {
    const h = fakeScope(baseConfig({ budget: { enabled: true, monthlyCny: 100 } }))
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)

    const amount = (): HTMLInputElement => screen.getByLabelText(/月度预算/) as HTMLInputElement
    for (const bad of ['', '0', '-5', 'abc']) {
      await act(async () => { fireEvent.change(amount(), { target: { value: bad } }) })
      await act(async () => { fireEvent.blur(amount()) })
      // 一次都不该写：0 会被 budget.ts 当成「无预算」，把 0 落盘等于悄悄关掉预算。
      expect(h.writes.filter((w) => w.field === 'budget')).toHaveLength(0)
      expect(amount().value).toBe('100')
    }
  })

  it('设置面只读时预算金额输入禁用（不可写就不给能敲的入口）', () => {
    const h = fakeScope(baseConfig(), { writable: false })
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)
    expect((screen.getByLabelText(/月度预算/) as HTMLInputElement).disabled).toBe(true)
  })

  it('预算金额未配置时输入留空并显示占位而不是「0 元」', () => {
    const h = fakeScope({ ...baseConfig(), budget: { monthlyCny: undefined } as never })
    render(<SettingsSection billing={pricingRemote()} scope={h.scope} store={createBillingStore({ open: true })} />)
    const amount = screen.getByLabelText(/月度预算/) as HTMLInputElement
    expect(amount.value).toBe('')
    expect(amount.placeholder).toBe(NON_FINITE_PLACEHOLDER)
  })

  it('状态 / 价表取数 reject 时停在占位并留日志（不伪造行数或快照 id）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const h = fakeScope(baseConfig())
      const billing = noopRemote({
        status: async () => { throw new Error('wire down') },
        pricing: async () => { throw new Error('wire down') },
      } as never)
      const { baseElement: container } = render(<SettingsSection billing={billing} scope={h.scope} store={createBillingStore({ open: true })} />)
      expect(await screen.findByText(/账本 0 行/)).toBeTruthy()
      // installAt 未知时口径说明必须渲染占位：把「不知道」交给 formatDateTime 会印出
      // 「1970-01-01 08:00」，那是一个看起来像事实的假日期（ledger 已有此 ruling）。
      expect(container.textContent).not.toContain('1970')
      expect(screen.getByText(/本次加载时刻 —/)).toBeTruthy()
      await waitFor(() => {
        expect(warn).toHaveBeenCalledWith('[usage-billing] 设置页取数通道异常', expect.anything())
      })
    } finally { warn.mockRestore() }
  })

  it('status 到了但 installAt 不是正数（命名空间从未落盘）同样渲染占位，不报 1970', async () => {
    const h = fakeScope(baseConfig())
    const billing = noopRemote({
      status: async () => ({ ok: true, value: { installAt: 0, rows: 0, sessions: 0, snapshots: 0 } }),
    } as never)
    const { baseElement: container } = render(<SettingsSection billing={billing} scope={h.scope} store={createBillingStore({ open: true })} />)
    expect(await screen.findByText(/账本 0 行/)).toBeTruthy()
    expect(container.textContent).not.toContain('1970')
    expect(screen.getByText(/本次加载时刻 —/)).toBeTruthy()
  })

  it('远程面缺席时 effect 早退（不抛 TypeError）', async () => {
    const h = fakeScope(baseConfig())
    render(<SettingsSection billing={undefined} scope={h.scope} store={createBillingStore({ open: true })} />)
    // 状态区停在 0 行（status 未到），页面本身必须正常渲染。
    expect(screen.getByText(/账本 0 行/)).toBeTruthy()
    expect(screen.getByText(/计费口径：/)).toBeTruthy()
  })
})

/** 25 行的合成数据：过滤 / 排序 / 分页的边界（10 / 11 / 25）都在里面。 */
interface FakeRow { id: string; name: string; cost: number }

const FAKE_ROWS: FakeRow[] = Array.from({ length: 25 }, (_, i) => ({
  id: 'r' + i,
  name: 'model-' + i,
  cost: i,
}))

const FAKE_COLUMNS: ReadonlyArray<TableColumn<FakeRow>> = [
  { key: 'name', header: '模型名', main: true, sortValue: (row) => row.name, render: (row) => row.name },
  { key: 'cost', header: '费用列', align: 'right', sortValue: (row) => row.cost, render: (row) => String(row.cost) },
]

const renderTable = () => render(
  <DataTable
    columns={FAKE_COLUMNS}
    rows={FAKE_ROWS}
    rowKey={(row) => row.id}
    searchText={(row) => row.name}
    filterPlaceholder="过滤模型"
  />,
)

const bodyRowCount = (): number => screen.getAllByRole('row').length - 1
const firstBodyRow = (): string => screen.getAllByRole('row')[1]!.textContent ?? ''

describe('DataTable：过滤 / 排序 / 分页', () => {
  it('默认每页 10 行，工具条说总数，分页器说第几页', () => {
    renderTable()
    expect(bodyRowCount()).toBe(10)
    expect(screen.getByText('共 25 条')).toBeTruthy()
    expect(screen.getByText('1 / 3')).toBeTruthy()
    // 过滤框是一个有可访问名的真输入框（不是自绘的 div）。
    expect(screen.getByLabelText('过滤模型')).toBeTruthy()
  })

  it('翻页只换可见行，过滤条件不受影响', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(bodyRowCount()).toBe(10)
    expect(firstBodyRow()).toContain('model-10')
    // 到最后一页：下一页按钮必须禁用（而不是点了没反应）。
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('3 / 3')).toBeTruthy()
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true)
    expect(bodyRowCount()).toBe(5)
  })

  it('表头是一个可点按钮：升 → 降 → 取消（aria-sort 跟着走）', () => {
    renderTable()
    const header = screen.getByRole('button', { name: '按费用列排序' })
    fireEvent.click(header)
    expect(firstBodyRow()).toContain('model-0')
    expect(screen.getByRole('columnheader', { name: /费用列/ }).getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(header)
    expect(firstBodyRow()).toContain('model-24')
    expect(screen.getByRole('columnheader', { name: /费用列/ }).getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(header)
    // 第三次回到原始顺序（不是只能在升/降之间来回）。
    expect(firstBodyRow()).toContain('model-0')
    expect(screen.getByRole('columnheader', { name: /费用列/ }).getAttribute('aria-sort')).toBe('none')
  })

  it('过滤实时生效，命中数写进工具条；命中只剩 1 页时分页器消失', () => {
    renderTable()
    fireEvent.change(screen.getByLabelText('过滤模型'), { target: { value: 'model-1' } })
    // model-1 与 model-10..model-19 共 11 行命中 → 2 页。
    expect(screen.getByText('共 25 条 · 命中 11 条')).toBeTruthy()
    expect(screen.getByText('1 / 2')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('过滤模型'), { target: { value: 'model-13' } })
    expect(screen.getByText('共 25 条 · 命中 1 条')).toBeTruthy()
    expect(screen.queryByText(/1 \/ 2/)).toBeNull()
    expect(bodyRowCount()).toBe(1)
  })

  it('过滤到空集合时给的是「没有匹配」而不是一张空表', () => {
    renderTable()
    fireEvent.change(screen.getByLabelText('过滤模型'), { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的记录。')).toBeTruthy()
    expect(screen.getByText('共 25 条 · 命中 0 条')).toBeTruthy()
  })

  it('翻到第 3 页后再过滤：页码自动回落，不会停在一张空表上', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('3 / 3')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('过滤模型'), { target: { value: 'model-13' } })
    expect(bodyRowCount()).toBe(1)
    expect(firstBodyRow()).toContain('model-13')
  })

  it('换每页条数会回到第 1 页（10 → 20）', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('2 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '每页 20 条' }))
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(bodyRowCount()).toBe(20)
  })
})
