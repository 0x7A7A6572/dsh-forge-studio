/**
 * 侧栏入口卡（slot: sidebar.footer.action）—— 本月费用 + 预算进度条 + 近 7 天 sparkline。
 *
 * 这一屏刻意**只留两个数字**（本月合计、今日）与一条预算进度条：
 * - 日期（`09-16`）：侧栏里没人靠它定位，今日费用自带「今日」两个字就够了；
 * - 「内置价」徽标：价表来源是费率页的解释，不该在侧栏占用注意力；
 * - 「N 未收录」徽标：未收录的**事实**在概览 / 明细 / 费率三页都有明确落点，
 *   侧栏这条只有 10px 的字既说不清、又容易被读成「这些钱没算进去」的相反意思；
 * - 「含安装前估算」角标：金额同源的披露仍**全部保留**在弹窗与概览页（那里才有空间把
 *   「估算起点是本次宿主加载时刻」讲清楚），侧栏只去掉标记本身，不弱化口径。
 *
 * 预算进度条的颜色只由 `evaluateBudget` 的档位（ok / warn / over）决定，
 * 与概览页那条是同一个组件、同一份阈值。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { formatCny, formatPct, isUnpricedTotal } from '../core/format.ts'
import { evaluateBudget } from '../../budget.ts'
import { ProgressBar } from './components/progress-bar.tsx'
import { Sparkline } from './chart.tsx'
import type { DailyPoint, Overview } from '../../view.ts'

/** 概览未到 / 整本账未定价时的占位：`¥0.00` 与真实零费用在界面上无法区分。 */
const PENDING = '—'

/** 取数失败的金额占位：必须与"还没到"区分开，否则 wire 挂起时界面永远看不出出事了。 */
const FAILED = '!'

/**
 * 一次取数最多等这么久。价值不在"防止卡住"（读端点已经不阻塞在聚合上了），而在于让
 * **真的挂起**（wire 断了、远程面没挂上）有一个可解释的出口：到点显示「读取失败」，
 * 而不是让卡片永远停在 `—` —— 那正是这次故障里最误导人的地方。
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

export function EntryCard(props: EntryCardProps): JSX.Element {
  const { wide, billing, store } = props
  // 订阅 store：点击卡片 / 关闭按钮改状态后本组件（以及仪表盘）会重渲染。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const includeSubagents = state.includeSubagents
  const [overview, setOverview] = useState<Overview | null>(null)
  const [budget, setBudget] = useState<{ enabled: boolean; monthlyCny: number } | null>(null)
  const [days, setDays] = useState<DailyPoint[]>([])
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
      // 只取两条：预算随 overview 一起回来，价表来源（曾经的「内置价」徽标）侧栏不再需要。
      const [o, d] = await Promise.all([
        billing.overview('month', includeSubagents),
        billing.daily('7d', includeSubagents),
      ])
      if (!alive) return
      clearTimeout(timer)
      if (o.ok) {
        setOverview(o.value.overview)
        setBudget(o.value.budget)
      }
      if (d.ok) setDays(d.value.days)
      // 两条里一条都没成功 = 这一屏没有可信数字，明说失败；否则算就绪。
      setLoad(o.ok || d.ok ? 'ready' : 'failed')
    })().catch(() => {
      // 远程调用 reject（wire 层异常）时必须吞掉：否则是一条 unhandled rejection。
      // 但也不能装作无事发生 —— 转失败态，卡片上给出可解释的「读取失败」。
      // 刻意不写 console：宿主 UI 已有日志通道，且测试要求输出干净。
      if (alive) { clearTimeout(timer); setLoad('failed') }
    })
    return () => { alive = false; clearTimeout(timer) }
  }, [billing, includeSubagents])

  // 折线走 views/chart.tsx 的 Sparkline（此前这里另抄了一份 inline `<svg><polyline>`，
  // 于是 Sparkline 成了没人用的死代码，两份实现还会各自漂移）；空数据时 Sparkline 自己
  // 返回一个空 svg，这里按「有没有点」决定渲不渲染，保持原来的 DOM 形状。
  const sparkValues = useMemo(() => days.map((d) => d.costCny), [days])

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

  return (
    <button
      type="button"
      data-dsh-usage-billing
      data-dsh-ub-entry
      data-wide={String(wide)}
      data-dsh-ub-state={load}
      className="ub-entry"
      title={failed ? '计费：数据读取失败（点击重试）' : '计费'}
      aria-label={ariaLabel}
      onClick={() => store.togglePanel()}
    >
      <span className="ub-entry-text" data-dsh-ub-entry-text>
        <span className="ub-entry-line">
          <span className="ub-entry-amount" data-dsh-ub-amount>{amountText}</span>
          <span className="ub-entry-today" data-dsh-ub-today>今日 {todayText}</span>
        </span>
        {showBudget ? (
          // 进度条在按钮里是纯装饰：它的口径已经在按钮的 aria-label 里说全了，
          // 留着 role=progressbar 只会让屏幕阅读器在按钮内部再念一遍。
          <span className="ub-entry-budget" aria-hidden="true">
            <ProgressBar
              level={spend.level} ratio={spend.pct} thin
              label={`预算已用 ${formatPct(spend.pct, 0)}`}
            />
            <span className="ub-entry-pct">{formatPct(spend.pct, 0)}</span>
          </span>
        ) : null}
      </span>
      {wide && sparkValues.length > 0 ? (
        <span className="ub-entry-spark" aria-hidden="true">
          <Sparkline values={sparkValues} width={56} height={16} />
        </span>
      ) : null}
      {failed ? <span className="ub-badge" data-dsh-ub-badge data-kind="error">读取失败</span> : null}
    </button>
  )
}
