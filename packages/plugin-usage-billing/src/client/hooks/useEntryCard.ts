/** 计费入口（侧栏 / 输入框下方）共用的取数与文案。 */
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
import type { TierDayProfile } from '../../pricing/tiers.ts'
import { usePopoverSeat } from './usePopoverSeat.ts'
import { useRevision } from './useRevision.ts'

/** 概览未到 / 整本账未定价时的占位：`¥0.00` 与真实零费用在界面上无法区分。 */
const PENDING = '—'

/** 取数失败的金额占位：必须与「还没到」区分开，否则 wire 挂起时看不出出事。 */
const FAILED = '!'

/**
 * 一次取数最多等这么久：读端点已不阻塞在聚合上，
 * 超时只为真的挂起（wire 断了 / 远程面没挂上）留一个出口。
 */
const FETCH_TIMEOUT_MS = 15_000

type LoadState = 'loading' | 'ready' | 'failed'

export interface EntryDataProps {
  billing: UsageBillingRemote | undefined
  /** 视图状态由 `apply` 按 fiber 创建并传入（订阅式，不是模块级单例）。 */
  store: BillingStore
  /** 会话作用域插槽由框架解析出来的 sessionId；侧栏是 root 作用域，拿不到。 */
  sessionId?: string
  /** 同拍请求合并：两个入口要的是同一份 overview / byWorkspace。 */
  query: QueryCache
  /** 自动重取心跳（按 fiber 创建，见 core/revalidate.ts）。 */
  revalidate: Revalidator
}

/** popup 里的一行指标：key 决定色标。 */
export interface PopoverSegment {
  key: 'session' | 'workspace' | 'today' | 'others'
  label: string
  text: string
  /** 原始金额：入口卡的叠加条与 popup 的今日分布条按它算比例；未知为 null。 */
  value: number | null
}

export interface BudgetBarView {
  level: 'ok' | 'warn' | 'over'
  ratio: number
  pctText: string
  monthlyText: string
  /** 本月已用（所有项目）：多色段按它换算长度。 */
  spentValue: number
}

/** 会话 / 项目金额：当月（入口卡）、今日（分布条）、历史累计（累计两行）各一份。 */
interface Figures {
  sessionCny: number | null
  workspaceCny: number | null
  workspaceTodayCny: number | null
  sessionAllCny: number | null
  workspaceAllCny: number | null
}

/**
 * 所有数出自同一次 byWorkspace 响应（行里自带 todayCny / allCny）：
 * 不靠两次取数拼，避免「今日到了、累计还没到」的半截面板。
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
    // 新会话还没有任何行：0 是真实的零，不是未知；工作区无从得知。
    return { sessionCny: 0, workspaceCny: null, workspaceTodayCny: null, sessionAllCny: 0, workspaceAllCny: null }
  }
  // 侧栏没有会话上下文：「最近会话」取最近活跃的那条，其工作区即「最近项目」。
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
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const includeSubagents = state.includeSubagents
  // 心跳一拍换一个 revision，下面的 effect 依赖它重跑。
  const revision = useRevision(revalidate)
  const hasData = useRef(false)
  const seat = usePopoverSeat()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [budget, setBudget] = useState<{ enabled: boolean; monthlyCny: number } | null>(null)
  const [figures, setFigures] = useState<Figures | null>(null)
  /** 今日费率形状：与 overview 同一次响应回来，缺省（旧宿主）当「没有分时价」处理。 */
  const [tierDay, setTierDay] = useState<TierDayProfile | null>(null)
  const [load, setLoad] = useState<LoadState>('loading')

  useEffect(() => {
    // 远程面可能晚于首帧挂载：缺席即早退，等 billing 变化后 effect 重跑。
    if (billing === undefined) return
    let alive = true
    // 已有数字时这趟是静默刷新：不回到「加载中」，失败也不改已显示的数字。
    const silent = hasData.current
    if (!silent) setLoad('loading')
    // 挂起兜底：到点还没拿到任何一帧就转失败态（正常返回会清掉它）。
    const timer = setTimeout(() => { if (alive) setLoad((s) => (s === 'loading' ? 'failed' : s)) }, FETCH_TIMEOUT_MS)
    void (async () => {
      // 两条都取月窗口：预算 / 今日 / 会话 / 本项目同一口径，谁也不带偏谁。
      // 走 query 合并：两个入口同一拍只发一份（参数进 key，口径不会串）。
      const [o, w] = await Promise.all([
        query.run(overviewKey('month', includeSubagents), () => billing.overview('month', includeSubagents)),
        query.run(byWorkspaceKey('month', includeSubagents), () => billing.byWorkspace('month', includeSubagents)),
      ])
      if (!alive) return
      clearTimeout(timer)
      if (o.ok) {
        setOverview(o.value.overview)
        setBudget(o.value.budget)
        // 曲线只在拿到形状时才画：旧宿主不发这个字段，不能写死模板。
        setTierDay(o.value.tierDay ?? null)
        hasData.current = true
      }
      if (w.ok) {
        setFigures(figuresOf(w.value.workspaces, sessionId))
        hasData.current = true
      }
      // 会话金额与总账同一个成功判据：overview 一挂整条都不显示，不留半份数字。
      setLoad(o.ok && w.ok ? 'ready' : silent ? 'ready' : 'failed')
    })().catch(() => {
      // reject（wire 层异常）必须吞掉；从没拿到过数字才转失败态，否则保留已显示的数字。
      if (alive) { clearTimeout(timer); setLoad(silent ? 'ready' : 'failed') }
    })
    return () => { alive = false; clearTimeout(timer) }
  }, [billing, includeSubagents, sessionId, revision, query])

  // 一行都没定价时金额的 0 不可信；判据只用 core/format.ts 一处。
  const entirelyUnpriced = overview !== null
    && isUnpricedTotal(overview.totalCny, overview.unpricedModels)
  const priced = overview !== null && !entirelyUnpriced
  // 失败态只在从没拿到过概览时取代占位；已有数字不被抹掉。
  const failed = overview === null && load === 'failed'
  /** 金额统一出口：未定价一律占位，未知不能写成 `¥0.00`。 */
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
  // 「其他项目今日」= 今日合计 − 本项目今日：同一拍的两个数相减，不跨口径。
  const othersToday = overview === null || figures?.workspaceTodayCny == null
    ? null
    : Math.max(overview.todayCny - figures.workspaceTodayCny, 0)
  const othersTodayText = money(othersToday)
  // 顺序即颜色顺序；侧栏没有 sessionId，措辞跟着数据走。
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
  // popup 累计行：两个数并排，标签取最短形式。
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
  // 今日分布：今日合计就是整条本身，不给色标。
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

  // 判档传空 notified：入口不落盘，跨档提醒只在设置页判。
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
  /** popup 第一行只要 level 与 ratio，所以另给一份最小形状。 */
  const popoverBudget = budgetView === null ? null : { level: budgetView.level, ratio: budgetView.ratio }

  /** popup 标题值：分母只在「已用是个真数」时才拼 —— 未定价时 `— / ¥600` 会读成缺数。 */
  const headlineText = priced && budgetView !== null ? `${amountText} / ${budgetView.monthlyText}` : amountText

  const unpricedText = overview !== null && overview.unpricedModels.length > 0
    ? `未收录 ${overview.unpricedModels.length} 个模型，已按 ¥0 计`
    : null

  /** 无障碍名：整个入口是一个按钮，饼图与进度条不进 a11y 树，口径在这里说。 */
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
    tierDay,
    budgetBar: budgetView,
    popoverBudget,
    seat,
    ariaLabel,
  }
}
