/**
 * 概览页的取数与局部视图状态。
 *
 * 口径：三个取数都走 `'all'`（累计），**不跟随趋势页的范围切换** —— 这一页回答的是
 * 「一共用了多少 / 今天用了多少 / 最近活跃不活跃 / 哪些模型在吃 token」，范围窗口属于趋势页。
 * 自动重取见 core/revalidate.ts：心跳换 revision，本 hook 依赖它重取；同拍请求走 query 合并。
 *
 * 主数字为什么是 Token 而不是金额：token 是**观测事实**（永远精确），金额可能是未定价
 * 的未知（见 isUnpricedTotal）。金额仍在每张卡里并列出现，占位规则一个字没改 ——
 * 未知就写「—」，绝不写成 ¥0.00。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { BillingStore } from '../../core/store.ts'
import type { BillingScope } from '../../core/config.ts'
import { byModelKey, dailyKey, overviewKey } from '../../core/query.ts'
import type { QueryCache } from '../../core/query.ts'
import type { Revalidator } from '../../core/revalidate.ts'
import type { HeatWeeks } from '../../core/token-stats.ts'
import { useRevision } from '../../hooks/useRevision.ts'
import type { DailyPoint, ModelRow, Overview } from '../../../view.ts'

/** 三个响应同源落地：任一缺席就不渲染 —— 不存在「金额在、披露没了」的中间态。 */
export interface OverviewPayload {
  overview: Overview
  budget: { enabled: boolean; monthlyCny: number }
  /** 服务端认定的「今天」（YYYY-MM-DD）：今日卡用它取数，不用客户端时钟猜。 */
  todayKey: string
  days: DailyPoint[]
  models: ModelRow[]
}

export interface TabOverviewProps {
  /** 远程面首帧可能未挂载（`$mount` 异步且失败只 warn）：类型如实写出，effect 早退。 */
  billing: UsageBillingRemote | undefined
  store: BillingStore
  /** 显示偏好（`display.showUnpricedWarning`）读宿主设置；订阅，改完立即生效。 */
  scope: BillingScope
  /** 同一拍的重复请求合并。 */
  query: QueryCache
  /** 自动重取心跳（按 fiber 创建，见 core/revalidate.ts）。 */
  revalidate: Revalidator
}

/**
 * 概览里两张长卡（最近活跃度 / 分模型消耗）的开合。
 *
 * 状态**不在这里**：概览 / 趋势 / 明细是条件渲染，切走即卸载，状态留在本 hook 里会被
 * 重新挂载抹掉 —— 由设置分区（useSettingsSection）持有，从这里传进来。
 */
export interface OverviewDisclosure {
  activityOpen: boolean
  modelsOpen: boolean
  onToggleActivity: () => void
  onToggleModels: () => void
}

export function useTabOverview(props: TabOverviewProps) {
  const { billing, store, scope, query, revalidate } = props
  // 心跳一拍换一个 revision，下面的取数 effect 依赖它重跑。
  const revision = useRevision(revalidate)
  // 必须订阅（不订阅的话切子代理口径不会重取数据）：与设置页 / 入口卡同一姿态。
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
      query.run(overviewKey('all', state.includeSubagents), () => billing.overview('all', state.includeSubagents)),
      query.run(dailyKey('all', state.includeSubagents), () => billing.daily('all', state.includeSubagents)),
      query.run(byModelKey('all', state.includeSubagents), () => billing.byModel('all', state.includeSubagents)),
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
  }, [billing, state.includeSubagents, revision, query])

  return { data, weeks, setWeeks, showUnpricedWarning }
}
