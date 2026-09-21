/**
 * 计费入口（侧栏 / 输入框下方）的取数与文案：本月费用 + 今日 + 预算 + 会话与项目金额。
 *
 * 版式上的取舍：
 * - 入口**本体**只放「一眼要看到的那一个数」：侧栏保留原来的本月 + 今日 + 预算条，
 *   输入框下方那条只有一个小小的饼图 + 当前会话金额（它的邻居是宿主的胶囊，字更小）；
 * - 明细全部收进点击后的 popup（components/BillingPopover.tsx）。
 *
 * 「当前会话」与「本项目」都从 **byWorkspace('month')** 拿：host 没有会话维度的独立端点，
 * 而会话行本来就由工作区分组带回，用现成的端点比自己加一条线协议划算。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import type { SessionRow, WorkspaceRow } from '../../view.ts'
import { formatCny, formatPct, isUnpricedTotal } from '../core/format.ts'
import { evaluateBudget } from '../../budget.ts'
import type { Overview } from '../../view.ts'
import { usePopoverSeat } from './usePopoverSeat.ts'

/** 概览未到 / 整本账未定价时的占位：`¥0.00` 与真实零费用在界面上无法区分。 */
const PENDING = '—'

/** 取数失败的金额占位：必须与「还没到」区分开，否则 wire 挂起时界面永远看不出出事了。 */
const FAILED = '!'

/**
 * 一次取数最多等这么久。价值不在「防止卡住」（读端点已经不阻塞在聚合上了），而在于让
 * **真的挂起**（wire 断了、远程面没挂上）有一个可解释的出口：到点显示「读取失败」。
 */
const FETCH_TIMEOUT_MS = 15_000

/** 首次取数状态；一旦 `ready` 就不再回退（后续刷新失败不该把已有数字抹成失败）。 */
type LoadState = 'loading' | 'ready' | 'failed'

/** 两个入口组件共用的取数入参：数据、视图状态，以及（输入框下方那条才有的）当前会话 id。 */
export interface EntryDataProps {
  /** 远程面可能晚于首次渲染挂载（`usageBillingOf(c)` 先返回 undefined）。 */
  billing: UsageBillingRemote | undefined
  /** 视图状态由 `apply` 按 fiber 创建并传入（订阅式，不是模块级单例）。 */
  store: BillingStore
  /** 会话作用域插槽由框架解析出来的 sessionId；侧栏是 root 作用域，拿不到。 */
  sessionId?: string
}

/** popup 里的一行指标：key 决定颜色（session=色1 / workspace=色2 / today=色3）。 */
export interface PopoverSegment {
  key: 'session' | 'workspace' | 'today'
  label: string
  text: string
  /** 原始金额（Popup 用它算多色段的比例）；未知为 null。 */
  value: number | null
}

/** 预算条的展示数据（含 popup 标题要的月度总额）。 */
export interface BudgetBarView {
  level: 'ok' | 'warn' | 'over'
  ratio: number
  pctText: string
  monthlyText: string
  /** 本月已用金额（所有项目）：多色段在「已用段」内按它换算长度。 */
  spentValue: number
}

function figuresOf(rows: readonly WorkspaceRow[], sessionId: string | undefined): {
  sessionCny: number | null
  workspaceCny: number | null
} {
  if (sessionId !== undefined) {
    for (const w of rows) {
      const hit = w.sessions.find((s: SessionRow) => s.sessionId === sessionId)
      if (hit !== undefined) return { sessionCny: hit.costCny, workspaceCny: w.costCny }
    }
    // 新会话还没有任何行：0 是**真实的零**（不是未知），而它属于哪个工作区无从得知。
    return { sessionCny: 0, workspaceCny: null }
  }
  // 侧栏没有会话上下文：把最近活跃的那条会话当「最近会话」，它所在的工作区即「最近项目」。
  let best: { session: SessionRow; workspace: WorkspaceRow } | null = null
  for (const w of rows) {
    for (const s of w.sessions) {
      if (best === null || s.lastTime > best.session.lastTime) best = { session: s, workspace: w }
    }
  }
  if (best === null) return { sessionCny: null, workspaceCny: null }
  return { sessionCny: best.session.costCny, workspaceCny: best.workspace.costCny }
}

export function useEntryCard(props: EntryDataProps) {
  const { billing, store, sessionId } = props
  // 订阅 store：计入子代理口径变化后本组件（以及设置页里的视图）会重渲染。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const includeSubagents = state.includeSubagents
  const seat = usePopoverSeat()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [budget, setBudget] = useState<{ enabled: boolean; monthlyCny: number } | null>(null)
  const [figures, setFigures] = useState<{ sessionCny: number | null; workspaceCny: number | null } | null>(null)
  const [load, setLoad] = useState<LoadState>('loading')

  useEffect(() => {
    // 远程命名空间在 apply 里异步挂载；若本卡先渲染，`billing` 还是 undefined，
    // 直接调 `billing.overview(...)` 会在 async IIFE 里抛错 → unhandled rejection，
    // 卡片永远停在占位。缺席即早退，等 billing 变化后 effect 重跑。
    if (billing === undefined) return
    let alive = true
    setLoad('loading')
    // 挂起兜底：到点还没拿到任何一帧就转失败态（下面的正常返回会清掉它）。
    const timer = setTimeout(() => { if (alive) setLoad((s) => (s === 'loading' ? 'failed' : s)) }, FETCH_TIMEOUT_MS)
    void (async () => {
      // 两条都取月窗口：预算、今日、会话、本项目本来就是同一口径，谁也带不偏谁。
      const [o, w] = await Promise.all([
        billing.overview('month', includeSubagents),
        billing.byWorkspace('month', includeSubagents),
      ])
      if (!alive) return
      clearTimeout(timer)
      if (o.ok) {
        setOverview(o.value.overview)
        setBudget(o.value.budget)
      }
      if (w.ok) setFigures(figuresOf(w.value.workspaces, sessionId))
      // 会话金额与总账同一个成功判据：overview 一挂整条都不显示，不留半份数字。
      setLoad(o.ok && w.ok ? 'ready' : 'failed')
    })().catch(() => {
      // 远程调用 reject（wire 层异常）时必须吞掉：否则是一条 unhandled rejection。
      // 但也不能装作无事发生 —— 转失败态，卡片上给出可解释的「读取失败」。
      if (alive) { clearTimeout(timer); setLoad('failed') }
    })
    return () => { alive = false; clearTimeout(timer) }
  }, [billing, includeSubagents, sessionId])

  // 一行都没定价（totalCny 为 0 且存在未收录模型）时，金额同样是不可信的 0 ——
  // 判据来自 client/core/format.ts 的唯一实现，与概览 / 趋势 / 明细同一口径。
  const entirelyUnpriced = overview !== null
    && isUnpricedTotal(overview.totalCny, overview.unpricedModels)
  const priced = overview !== null && !entirelyUnpriced
  // 失败态只在**从没拿到过概览**时取代占位：已显示的数字不因后续刷新失败被抹掉。
  const failed = overview === null && load === 'failed'
  /** 金额统一出口：未定价一律占位，绝不把未知写成 ¥0.00。 */
  const money = (value: number | null): string => {
    if (value === null) return PENDING
    if (!priced) return failed ? FAILED : PENDING
    return formatCny(value)
  }
  const amountText = money(overview?.totalCny ?? null)
  const todayText = money(overview?.todayCny ?? null)
  const sessionText = money(figures?.sessionCny ?? null)
  const workspaceText = money(figures?.workspaceCny ?? null)
  // 顺序即颜色顺序（session → workspace → today）；侧栏没有 sessionId，措辞跟着数据走。
  const segments: PopoverSegment[] = [
    {
      key: 'session',
      label: sessionId === undefined ? '最近会话' : '当前会话',
      text: sessionText,
      value: figures?.sessionCny ?? null,
    },
    {
      key: 'workspace',
      label: sessionId === undefined ? '最近项目' : '本项目',
      text: workspaceText,
      value: figures?.workspaceCny ?? null,
    },
    { key: 'today', label: '今日', text: todayText, value: overview?.todayCny ?? null },
  ]

  // 预算档位：阈值判据只有 budget.ts 一处（notified 传空对象 —— 入口不承担跨档提醒，
  // 那只在设置页判并落盘，不能因为入口渲染就写坏「每月每档一次」的标记）。
  /** 本月已花：判档与算余额必须是同一个数，所以只在这里取一次。 */
  const spentCny = overview?.totalCny ?? 0
  const spend = overview !== null && budget !== null
    ? evaluateBudget({
      spentCny, monthlyCny: budget.monthlyCny,
      enabled: budget.enabled, notified: {}, monthKey: '',
    })
    : null
  const showBudget = spend !== null && budget !== null && budget.enabled && budget.monthlyCny > 0
  const budgetView: BudgetBarView | null = showBudget
    ? {
      level: spend.level,
      ratio: spend.pct,
      pctText: formatPct(spend.pct, 0),
      monthlyText: formatCny(budget.monthlyCny),
      // 多色段是在「已用段」里量的：每段长度 = 该指标金额 ÷ 本月已用。
      spentValue: spentCny,
    }
    : null

  /** popup 标题值：分母只在「已用是个真数」时才拼 —— 未定价时 `— / ¥600` 会读成缺数。 */
  const headlineText = priced && budgetView !== null ? `${amountText} / ${budgetView.monthlyText}` : amountText

  /** 未收录是**事实**：一句到底，不解释原理。 */
  const unpricedText = overview !== null && overview.unpricedModels.length > 0
    ? `未收录 ${overview.unpricedModels.length} 个模型，已按 ¥0 计`
    : null

  /** 无障碍名：整个入口是一个按钮，饼图与进度条都不在 a11y 树里，口径要在这里说。 */
  const ariaLabel = budgetView !== null
    ? `计费：本月 ${amountText}，今日 ${todayText}，预算已用 ${budgetView.pctText}`
    : `计费：本月 ${amountText}，今日 ${todayText}`

  return {
    load,
    failed,
    amountText,
    headlineText,
    todayText,
    sessionText,
    segments,
    unpricedText,
    budgetBar: budgetView,
    seat,
    ariaLabel,
  }
}
