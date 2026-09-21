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
 *
 * 自动重取：心跳（core/revalidate.ts）一拍换一个 revision，本 hook 依赖它重跑取数。
 * 重取是**静默**的 —— 已有数字不闪回占位，失败也不把旧数字抹成失败态。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import { byWorkspaceKey, overviewKey } from '../core/query.ts'
import type { QueryCache } from '../core/query.ts'
import type { Revalidator } from '../core/revalidate.ts'
import type { BillingStore } from '../core/store.ts'
import type { SessionRow, WorkspaceRow } from '../../view.ts'
import { formatCny, formatPct, isUnpricedTotal } from '../core/format.ts'
import { evaluateBudget } from '../../budget.ts'
import type { Overview } from '../../view.ts'
import { usePopoverSeat } from './usePopoverSeat.ts'
import { useRevision } from './useRevision.ts'

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
  /** 同一拍的重复请求合并：两个入口要的是同一份 overview / byWorkspace。 */
  query: QueryCache
  /** 自动重取心跳（按 fiber 创建，见 core/revalidate.ts）。 */
  revalidate: Revalidator
}

/** popup 里的一行指标：key 决定颜色（session=色1 / workspace=色2 / today=色3 / others=色4）。 */
export interface PopoverSegment {
  key: 'session' | 'workspace' | 'today' | 'others'
  label: string
  text: string
  /** 原始金额：入口卡的叠加条与 popup 的今日分布条都用它算比例；未知为 null。 */
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

/** 会话 / 项目的金额：当月（入口卡与标题）、今日（分布条）与**历史累计**（累计两行）各一份。 */
interface Figures {
  sessionCny: number | null
  workspaceCny: number | null
  workspaceTodayCny: number | null
  sessionAllCny: number | null
  workspaceAllCny: number | null
}

/**
 * 所有数出自**同一次** byWorkspace 响应（行里自带 todayCny / allCny）：时间轴与包含关系都靠这一份
 * 数据说话，不靠两次取数拼，也不会出现「今日到了、累计还没到」的半截面板。
 */
function figuresOf(rows: readonly WorkspaceRow[], sessionId: string | undefined): Figures {
  if (sessionId !== undefined) {
    for (const w of rows) {
      const hit = w.sessions.find((s: SessionRow) => s.sessionId === sessionId)
      if (hit !== undefined) {
        return {
          sessionCny: hit.costCny, workspaceCny: w.costCny,
          workspaceTodayCny: w.todayCny, sessionAllCny: hit.allCny, workspaceAllCny: w.allCny,
        }
      }
    }
    // 新会话还没有任何行：0 是**真实的零**（不是未知），而它属于哪个工作区无从得知。
    return { sessionCny: 0, workspaceCny: null, workspaceTodayCny: null, sessionAllCny: 0, workspaceAllCny: null }
  }
  // 侧栏没有会话上下文：把最近活跃的那条会话当「最近会话」，它所在的工作区即「最近项目」。
  let best: { session: SessionRow; workspace: WorkspaceRow } | null = null
  for (const w of rows) {
    for (const s of w.sessions) {
      if (best === null || s.lastTime > best.session.lastTime) best = { session: s, workspace: w }
    }
  }
  if (best === null) {
    return {
      sessionCny: null, workspaceCny: null, workspaceTodayCny: null,
      sessionAllCny: null, workspaceAllCny: null,
    }
  }
  return {
    sessionCny: best.session.costCny,
    workspaceCny: best.workspace.costCny,
    workspaceTodayCny: best.workspace.todayCny,
    sessionAllCny: best.session.allCny,
    workspaceAllCny: best.workspace.allCny,
  }
}

export function useEntryCard(props: EntryDataProps) {
  const { billing, store, sessionId, query, revalidate } = props
  // 订阅 store：计入子代理口径变化后本组件（以及设置页里的视图）会重渲染。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const includeSubagents = state.includeSubagents
  // 心跳一拍换一个 revision，下面的 effect 依赖它重跑。
  const revision = useRevision(revalidate)
  /** 已经显示过一帧数据没有：决定这一趟是「加载中」还是静默刷新。 */
  const hasData = useRef(false)
  const seat = usePopoverSeat()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [budget, setBudget] = useState<{ enabled: boolean; monthlyCny: number } | null>(null)
  const [figures, setFigures] = useState<Figures | null>(null)
  const [load, setLoad] = useState<LoadState>('loading')

  useEffect(() => {
    // 远程命名空间在 apply 里异步挂载；若本卡先渲染，`billing` 还是 undefined，
    // 直接调 `billing.overview(...)` 会在 async IIFE 里抛错 → unhandled rejection，
    // 卡片永远停在占位。缺席即早退，等 billing 变化后 effect 重跑。
    if (billing === undefined) return
    let alive = true
    // 已有数字时这一趟是**静默刷新**：不回到「加载中」，失败也不把数字变成失败态
    // （失败态只属于「一帧都没拿到」的那次，与下面 failed 的判据同源）。
    const silent = hasData.current
    if (!silent) setLoad('loading')
    // 挂起兜底：到点还没拿到任何一帧就转失败态（下面的正常返回会清掉它）。
    const timer = setTimeout(() => { if (alive) setLoad((s) => (s === 'loading' ? 'failed' : s)) }, FETCH_TIMEOUT_MS)
    void (async () => {
      // 两条都取月窗口：预算、今日、会话、本项目本来就是同一口径，谁也带不偏谁。
      // 走 query 合并：两个入口同时挂载时同一拍只发一份（参数进 key，口径不会串）。
      const [o, w] = await Promise.all([
        query.run(overviewKey('month', includeSubagents), () => billing.overview('month', includeSubagents)),
        query.run(byWorkspaceKey('month', includeSubagents), () => billing.byWorkspace('month', includeSubagents)),
      ])
      if (!alive) return
      clearTimeout(timer)
      if (o.ok) {
        setOverview(o.value.overview)
        setBudget(o.value.budget)
        hasData.current = true
      }
      if (w.ok) {
        setFigures(figuresOf(w.value.workspaces, sessionId))
        hasData.current = true
      }
      // 会话金额与总账同一个成功判据：overview 一挂整条都不显示，不留半份数字。
      setLoad(o.ok && w.ok ? 'ready' : silent ? 'ready' : 'failed')
    })().catch(() => {
      // 远程调用 reject（wire 层异常）时必须吞掉：否则是一条 unhandled rejection。
      // 但也不能装作无事发生 —— 从没拿到过数字才转失败态，否则保留已显示的数字。
      if (alive) { clearTimeout(timer); setLoad(silent ? 'ready' : 'failed') }
    })
    return () => { alive = false; clearTimeout(timer) }
  }, [billing, includeSubagents, sessionId, revision, query])

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
  const sessionAllText = money(figures?.sessionAllCny ?? null)
  const workspaceAllText = money(figures?.workspaceAllCny ?? null)
  const projectTodayText = money(figures?.workspaceTodayCny ?? null)
  // 「其他项目今日」= 今日合计 − 本项目今日：两个数都来自同一拍，减法不跨口径。
  const othersToday = overview === null || figures?.workspaceTodayCny == null
    ? null
    : Math.max(overview.todayCny - figures.workspaceTodayCny, 0)
  const othersTodayText = money(othersToday)
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
  // popup 的累计行：两个数并排在一行里，所以标签取最短的形式（时间轴由行首的「累计」交代）。
  const totalSegments: PopoverSegment[] = [
    {
      key: 'session',
      label: sessionId === undefined ? '最近会话' : '会话',
      text: sessionAllText,
      value: figures?.sessionAllCny ?? null,
    },
    {
      key: 'workspace',
      label: sessionId === undefined ? '最近项目' : '项目',
      text: workspaceAllText,
      value: figures?.workspaceAllCny ?? null,
    },
  ]
  // popup 下半（今日消耗分布）：前两段并排铺满整条；今日合计是整条本身，所以不给色标。
  const todaySegments: PopoverSegment[] = [
    {
      key: 'workspace',
      label: sessionId === undefined ? '最近项目今日' : '本项目今日',
      text: projectTodayText,
      value: figures?.workspaceTodayCny ?? null,
    },
    { key: 'others', label: '其他项目今日', text: othersTodayText, value: othersToday },
    { key: 'today', label: '今日合计', text: todayText, value: overview?.todayCny ?? null },
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
  /** popup 第一行只画「本月已用 / 预算」的进度：用不到三轴那份数据，所以另给一份最小形状。 */
  const popoverBudget = budgetView === null ? null : { level: budgetView.level, ratio: budgetView.ratio }

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
    totalSegments,
    todaySegments,
    unpricedText,
    budgetBar: budgetView,
    popoverBudget,
    seat,
    ariaLabel,
  }
}
