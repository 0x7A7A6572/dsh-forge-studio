/**
 * 设置页（slot: settings.section）：预算、显示偏好、价表刷新、口径说明。
 *
 * 设置快照走宿主真实的 `ctx.settingsScope.bind<T>({ namespace })` 面
 * （`getSnapshot` / `subscribe`，与 plugin-daily-log 的设置分区同一姿态）——
 * 本地再声明一个 `{ get, watch }` 影子契约在宿主里根本不存在。
 * 样式由 client `apply` 经 `ctx.effect` 注入（这里不再重复注入：没有 ctx 可用，
 * 且同一 fiber 注入两次只会多留一个节点）。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UsageBillingRemote } from '../core/remote.ts'
import { BackfillLedgerNote } from './backfill-notice.tsx'

/** 本分区真正读到的配置片（`SettingsScope<BillingConfigLike>` 结构上兼容它）。 */
interface ConfigLike {
  budget?: { enabled?: boolean; monthlyCny?: number }
  display?: { includeSubagents?: boolean }
  pricing?: { autoRefresh?: boolean }
}

export function SettingsSection(props: { billing: UsageBillingRemote; scope: SettingsScope<ConfigLike> }): JSX.Element {
  const { billing, scope } = props
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const cfg = settings.value
  const [status, setStatus] = useState<{ installAt: number; rows: number; sessions: number } | null>(null)
  const [snapshotId, setSnapshotId] = useState('—')

  useEffect(() => {
    let alive = true
    void Promise.all([billing.status(), billing.pricing()]).then(([s, p]) => {
      if (!alive) return
      if (s.ok) setStatus(s.value)
      if (p.ok) setSnapshotId(p.value.snapshotId)
    })
    return () => { alive = false }
  }, [billing])

  /** 写整段 pricing（与 plugin-notes 写 webdav 同姿态）：schema 会用 base 补上未写的字段。 */
  const writeAutoRefresh = useCallback((next: boolean) => {
    void scope.set('pricing', { ...(cfg?.pricing ?? {}), autoRefresh: next })
      .catch(() => { /* 写失败时不回弹：快照仍是 host 的真值 */ })
  }, [scope, cfg])

  return (
    <section data-dsh-usage-billing>
      <h3>月度预算</h3>
      <label>
        <input type="checkbox" checked={cfg?.budget?.enabled ?? false} readOnly /> 启用预算提醒（50% / 80% / 100% 各提醒一次）
      </label>
      <div data-dsh-ub-sub>预算金额：{cfg?.budget?.monthlyCny ?? 0} 元（在「计费」页的费率分区随账本一起查看）</div>

      <h3>显示</h3>
      <label>
        <input type="checkbox" checked={cfg?.pricing?.autoRefresh ?? true} disabled={!settings.writable}
          onChange={(e) => { writeAutoRefresh(e.target.checked) }} /> 自动联网刷新价表与汇率（6 小时一次）
      </label>
      <label><input type="checkbox" checked={cfg?.display?.includeSubagents ?? true} readOnly /> 统计包含子代理会话</label>

      <h3>状态</h3>
      <div data-dsh-ub-sub>
        账本 {status?.rows ?? 0} 行 · 已折叠 {status?.sessions ?? 0} 个会话
      </div>

      <h3>计费口径</h3>
      <BackfillLedgerNote installAt={status?.installAt ?? 0} snapshotId={snapshotId} />
    </section>
  )
}
