/**
 * 概览：单列堆叠四张卡 —— 累计 Token 消耗 / 今日 Token 消耗 / 最近活跃度 / 分模型消耗。
 *
 * 口径：三个取数都走 `'all'`（累计），**不跟随趋势页的范围切换** —— 这一页回答的是
 * 「一共用了多少 / 今天用了多少 / 最近活跃不活跃 / 哪些模型在吃 token」，范围窗口属于趋势页。
 *
 * 主数字为什么是 Token 而不是金额：token 是**观测事实**（永远精确），金额可能是未定价
 * 的未知（见 isUnpricedTotal）。金额仍在每张卡里并列出现，占位规则一个字没改 ——
 * 未知就写「—」，绝不写成 ¥0.00。
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import type { BillingScope } from '../core/config.ts'
import { evaluateBudget } from '../../budget.ts'
import {
  NON_FINITE_PLACEHOLDER, backfilledDisclosure, formatCny, formatInt, formatPct, isUnpricedTotal,
} from '../core/format.ts'
import {
  HEAT_WINDOWS, HEAT_WINDOW_LABEL, activeDays, cacheHitRate, longestStreak,
  sumDays, totalTokens, windowDays, windowStart,
} from '../core/token-stats.ts'
import type { HeatWeeks } from '../core/token-stats.ts'
import { Card } from './components/kit.tsx'
import { DataTable } from './components/data-table.tsx'
import type { TableColumn } from './components/data-table.tsx'
import { HeroCard } from './components/hero-card.tsx'
import { BUDGET_LEVEL_LABEL, ProgressBar } from './components/progress-bar.tsx'
import { HeatChart, HeatLegend } from './heat-chart.tsx'
import type { DailyPoint, ModelRow, Overview } from '../../view.ts'

/** 三个响应同源落地：任一缺席就不渲染 —— 不存在「金额在、披露没了」的中间态。 */
interface OverviewPayload {
  overview: Overview
  budget: { enabled: boolean; monthlyCny: number }
  /** 服务端认定的「今天」（YYYY-MM-DD）：今日卡用它取数，不用客户端时钟猜。 */
  todayKey: string
  days: DailyPoint[]
  models: ModelRow[]
}

/** 今日还没有用量时的零值（结构上与 DailyPoint 一致，避免到处写可选判断）。 */
const ZERO_DAY: DailyPoint = {
  day: '', costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0,
}

/** 过滤用的可搜索文本（模块级常量：身份稳定，列表的 memo 才不会每帧重算）。 */
const modelSearch = (m: ModelRow): string =>
  m.providers.join(' ') + ' ' + m.model + ' ' + m.rawModels.join(' ')

export function TabOverview(props: {
  /** 远程面首帧可能未挂载（`$mount` 异步且失败只 warn）：类型如实写出，effect 早退。 */
  billing: UsageBillingRemote | undefined
  store: BillingStore
  /** 显示偏好（`display.showUnpricedWarning`）读宿主设置；订阅，改完立即生效。 */
  scope: BillingScope
}): JSX.Element {
  const { billing, store, scope } = props
  // 必须订阅（不订阅的话切子代理口径不会重取数据）：与 Dashboard / 入口卡同一姿态。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const showUnpricedWarning = settings.value?.display?.showUnpricedWarning !== false
  const [data, setData] = useState<OverviewPayload | null>(null)
  // 活跃度窗口是本页的局部视图状态：它不影响任何取数（数据一次取全量，前端切窗口）。
  const [weeks, setWeeks] = useState<HeatWeeks>(21)

  useEffect(() => {
    if (billing === undefined) return
    let alive = true
    void Promise.all([
      billing.overview('all', state.includeSubagents),
      billing.daily('all', state.includeSubagents),
      billing.byModel('all', state.includeSubagents),
    ]).then(([o, d, m]) => {
      if (!alive) return
      // host 报错（!ok）不是「花了 0 元」：停在「正在读取用量…」并留下日志，
      // 也不用另外两个成功的响应拼出一个口径不完整的面板。
      if (!o.ok) { console.warn('[usage-billing] 概览取数失败', o.error); return }
      if (!d.ok) { console.warn('[usage-billing] 概览取数失败', d.error); return }
      if (!m.ok) { console.warn('[usage-billing] 概览取数失败', m.error); return }
      setData({
        overview: o.value.overview,
        budget: o.value.budget,
        todayKey: o.value.todayKey,
        days: d.value.days,
        models: m.value.models,
      })
    }).catch((error: unknown) => {
      // wire 层 reject 同理（与入口卡同一处理）：保持占位，绝不伪造一个零金额。
      console.warn('[usage-billing] 概览通道异常', error)
    })
    return () => { alive = false }
  }, [billing, state.includeSubagents])

  const columns: ReadonlyArray<TableColumn<ModelRow>> = useMemo(() => [
    {
      key: 'provider',
      header: 'Provider',
      sortValue: (m) => m.providers.join(' / '),
      // 同名模型跨 provider 并成一行：provider 一个都不丢，全列出来。
      render: (m) => m.providers.join(' / '),
    },
    { key: 'model', header: '模型', main: true, sortValue: (m) => m.model, render: (m) => m.model },
    {
      key: 'tokens',
      header: '总 Token',
      align: 'right',
      sortValue: (m) => totalTokens(m),
      render: (m) => formatInt(totalTokens(m)),
    },
    { key: 'input', header: '未命中输入', align: 'right', sortValue: (m) => m.input, render: (m) => formatInt(m.input) },
    { key: 'cacheRead', header: '缓存读', align: 'right', sortValue: (m) => m.cacheRead, render: (m) => formatInt(m.cacheRead) },
    { key: 'output', header: '输出', align: 'right', sortValue: (m) => m.output, render: (m) => formatInt(m.output) },
    {
      key: 'cost',
      header: '费用',
      align: 'right',
      sortValue: (m) => m.costCny,
      // 未计价行绝不能显示 ¥0.00：那读起来是「免费」。零额 + 未计价时明确写未收录。
      render: (m) => (!m.priced && m.costCny === 0
        ? <span className="ub-unpriced">未收录</span>
        : <>{formatCny(m.costCny)}</>),
    },
    {
      key: 'note',
      header: '备注',
      // 三段都是本单元格的直接文本节点：getByText 才读得到完整备注。
      render: (m) => (!m.priced ? '未收录 · ' : '')
        + (m.mixedRate ? '混合单价 · ' : '')
        + (m.rawModels.length > 1 ? `${m.rawModels.length} 个原始 id` : ''),
    },
  ], [])

  if (data === null) return <div className="ub-empty" data-dsh-ub-empty>正在读取用量…</div>
  const { overview, budget, todayKey, days, models } = data
  // 唯一判据（client/core/format.ts）：整份账一行都没定价时，本页**所有**金额级数字都占位。
  const unpriced = isUnpricedTotal(overview.totalCny, overview.unpricedModels)
  const money = (n: number): string => unpriced ? NON_FINITE_PLACEHOLDER : formatCny(n)

  const all = sumDays(days)
  const today = days.find((d) => d.day === todayKey) ?? ZERO_DAY
  // 预算天然是**月度**口径：从全量按天数据里切当月，而不是拿「累计金额」去比月度预算。
  const monthKey = todayKey.slice(0, 7)
  const monthSpend = days.reduce((sum, d) => (d.day.startsWith(monthKey) ? sum + d.costCny : sum), 0)
  const spend = evaluateBudget({
    spentCny: monthSpend, monthlyCny: budget.monthlyCny,
    enabled: budget.enabled, notified: {}, monthKey,
  })
  // 窗口以「今天」结尾（而不是最后一条记录）：最近几天没用量的空格子也要画出来。
  const windowDaysList = windowDays(days, windowStart(todayKey, weeks), todayKey)
  const windowCost = windowDaysList.reduce((sum, d) => sum + d.costCny, 0)

  const cells = (
    t: Pick<DailyPoint, 'input' | 'cacheRead' | 'output' | 'calls'>,
  ): ReadonlyArray<{ label: string; value: string }> => [
    { label: '未命中输入', value: formatInt(t.input) },
    { label: '缓存读', value: formatInt(t.cacheRead) },
    { label: '输出', value: formatInt(t.output) },
    { label: '调用次数', value: formatInt(t.calls) },
  ]

  return (
    <div className="ub-section" data-dsh-usage-billing>
      <HeroCard
        title="累计 Token 消耗"
        value={formatInt(totalTokens(all))}
        unit="总消耗 Token"
        cells={cells(all)}
        subtitle={
          <>
            累计费用 <span data-dsh-ub-money>{money(overview.totalCny)}</span>
            {' · '}缓存命中率 {formatPct(cacheHitRate(all))}
            {/* 计数是**事实**，不随 display.showUnpricedWarning 开关消失（关掉的只是下面那条解释文案）。 */}
            {overview.unpricedModels.length > 0 ? (
              <>
                {' · '}
                {/* 分隔号放在 span **外面**：读屏（与测试）按元素全文取名字，'
                    · 1 未收录' 和 '1 未收录' 是两回事。 */}
                <span className="ub-unpriced">{overview.unpricedModels.length + ' 未收录'}</span>
              </>
            ) : null}
            {/* 标记与金额同源（同一次 overview 响应）；缺席按 present 处理，与另外三个分区同一保守口径。 */}
            {backfilledDisclosure(overview.hasBackfilled)
              ? <span className="ub-estimate" data-dsh-ub-estimate> · 含安装前估算</span>
              : null}
          </>
        }
        footnote={budget.enabled ? (
          <>
            <div className="ub-bar-meta">
              <span>本月预算 {formatCny(budget.monthlyCny)}</span>
              <span>·</span>
              <span>已用 {formatPct(spend.pct, 0)}</span>
              <span>·</span>
              <span>{BUDGET_LEVEL_LABEL[spend.level]}</span>
              {spend.pct >= 1
                ? <span className="ub-danger">超支 {formatCny(monthSpend - budget.monthlyCny)}</span>
                : null}
            </div>
            <ProgressBar
              level={spend.level}
              ratio={spend.pct}
              label={`月度预算已用 ${formatPct(spend.pct, 0)}`}
            />
          </>
        ) : undefined}
      />

      <HeroCard
        title="今日 Token 消耗"
        value={formatInt(totalTokens(today))}
        unit="今日 Token"
        cells={cells(today)}
        subtitle={
          <>
            今日费用 <span data-dsh-ub-money>{money(overview.todayCny)}</span>
            {today.calls === 0 ? <span> · 今天还没有用量</span> : null}
          </>
        }
      />

      <Card
        title="最近活跃度"
        extra={(
          <div className="ub-tabs" role="group" aria-label="活跃度时间窗">
            {HEAT_WINDOWS.map((w) => (
              <Pill key={w} active={w === weeks} onClick={() => { setWeeks(w) }}>
                {HEAT_WINDOW_LABEL[w]}
              </Pill>
            ))}
          </div>
        )}
      >
        <HeatChart days={windowDaysList} unpriced={unpriced} />
        <div className="ub-activity-foot">
          <HeatLegend />
          <span className="ub-sub">
            活跃 {formatInt(activeDays(windowDaysList))} 天 · 最长连续 {formatInt(longestStreak(windowDaysList))} 天
            {' · '}区间合计 <span data-dsh-ub-money>{money(windowCost)}</span>
          </span>
        </div>
      </Card>

      <Card title="分模型消耗">
        <DataTable
          columns={columns}
          rows={models}
          rowKey={(m) => m.key}
          empty="这个范围里还没有按模型的用量。"
          defaultSort={{ key: 'tokens', dir: 'desc' }}
          searchText={modelSearch}
          filterPlaceholder="过滤模型"
        />
      </Card>

      {/* 未收录提示条是**可关的偏好**（display.showUnpricedWarning）；卡里的金额与徽标
          是事实，不受该开关影响 —— 关掉的只是这条解释性文案。 */}
      {overview.unpricedModels.length > 0 && showUnpricedWarning ? (
        <p className="ub-estimate" data-dsh-ub-estimate>
          {overview.unpricedRows} 条记录涉及 {overview.unpricedModels.length} 个未收录模型（
          {overview.unpricedModels.slice(0, 3).join('、')}），已按 ¥0 计但未静默忽略 —— 到「费率」页补单价即可。
        </p>
      ) : null}
    </div>
  )
}
