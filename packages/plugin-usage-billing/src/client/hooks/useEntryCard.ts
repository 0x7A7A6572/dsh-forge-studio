/**
 * 侧栏入口卡的取数与文案：本月费用 + 今日 + 预算进度。
 *
 * 这一屏刻意**只留两个数字**（本月合计、今日）与一条预算进度条：
 * - 日期（`09-16`）：侧栏里没人靠它定位，今日费用自带「今日」两个字就够了；
 * - 「内置价」徽标：价表来源是费率页的解释，不该在侧栏占用注意力；
 * - 「N 未收录」徽标：未收录的**事实**在概览 / 明细 / 费率三页都有明确落点，
 *   侧栏这条只有 10px 的字既说不清、又容易被读成「这些钱没算进去」的相反意思；
 * - 「含安装前估算」角标：金额同源的披露仍**全部保留**在弹窗与概览页。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { formatCny, formatPct, isUnpricedTotal } from '../core/format.ts'
import { evaluateBudget } from '../../budget.ts'
import type { Overview } from '../../view.ts'

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

export interface EntryCardProps {
  /** ownerProps：sidebar 是否为宽态（false = 56px rail）。 */
  wide: boolean
  /** 远程面可能晚于首次渲染挂载（`usageBillingOf(c)` 先返回 undefined）。 */
  billing: UsageBillingRemote | undefined
  /** 视图状态由 `apply` 按 fiber 创建并传入（订阅式，不是模块级单例）。 */
  store: BillingStore
}

export function useEntryCard(props: EntryCardProps) {
  const { billing, store } = props
  // 订阅 store：点击卡片 / 关闭按钮改状态后本组件（以及仪表盘）会重渲染。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const includeSubagents = state.includeSubagents
  const [overview, setOverview] = useState<Overview | null>(null)
  const [budget, setBudget] = useState<{ enabled: boolean; monthlyCny: number } | null>(null)
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
      // 只取一条：预算随 overview 一起回来。这个卡在每次会话列表重渲时都会被挂载，
      // 少一条 daily('7d') 就少一次全量聚合。
      const o = await billing.overview('month', includeSubagents)
      if (!alive) return
      clearTimeout(timer)
      if (o.ok) {
        setOverview(o.value.overview)
        setBudget(o.value.budget)
      }
      setLoad(o.ok ? 'ready' : 'failed')
    })().catch(() => {
      // 远程调用 reject（wire 层异常）时必须吞掉：否则是一条 unhandled rejection。
      // 但也不能装作无事发生 —— 转失败态，卡片上给出可解释的「读取失败」。
      if (alive) { clearTimeout(timer); setLoad('failed') }
    })
    return () => { alive = false; clearTimeout(timer) }
  }, [billing, includeSubagents])

  // 一行都没定价（totalCny 为 0 且存在未收录模型）时，金额同样是不可信的 0 ——
  // 判据来自 client/core/format.ts 的唯一实现，与概览 / 趋势 / 热力图同一口径。
  const entirelyUnpriced = overview !== null
    && isUnpricedTotal(overview.totalCny, overview.unpricedModels)
  const priced = overview !== null && !entirelyUnpriced
  // 失败态只在**从没拿到过概览**时取代占位：已显示的数字不因后续刷新失败被抹掉。
  const failed = overview === null && load === 'failed'
  const amountText = priced ? formatCny(overview.totalCny) : failed ? FAILED : PENDING
  const todayText = priced ? formatCny(overview.todayCny) : PENDING

  // 预算档位：阈值判据只有 budget.ts 一处（notified 传空对象 —— 卡片不承担跨档提醒，
  // 那只在弹窗里判并落盘，不能因为侧栏渲染就写坏「每月每档一次」的标记）。
  const spend = overview !== null && budget !== null
    ? evaluateBudget({
      spentCny: overview.totalCny, monthlyCny: budget.monthlyCny,
      enabled: budget.enabled, notified: {}, monthKey: '',
    })
    : null
  const showBudget = spend !== null && budget !== null && budget.enabled && budget.monthlyCny > 0

  /** 无障碍名：整个卡片是一个按钮，里面的进度条不出现在 a11y 树里，预算口径要在这里说。 */
  const ariaLabel = showBudget
    ? `计费：本月 ${amountText}，预算已用 ${formatPct(spend.pct, 0)}`
    : `计费：本月 ${amountText}`

  const togglePanel = useCallback(() => { store.togglePanel() }, [store])

  return {
    load,
    failed,
    amountText,
    todayText,
    ariaLabel,
    togglePanel,
    budgetBar: showBudget
      ? {
        level: spend.level,
        ratio: spend.pct,
        label: `预算已用 ${formatPct(spend.pct, 0)}`,
        pctText: formatPct(spend.pct, 0),
      }
      : null,
  }
}
