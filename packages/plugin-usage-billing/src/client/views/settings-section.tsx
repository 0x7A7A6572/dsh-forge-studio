/**
 * 设置页（slot: settings.section）：预算、显示偏好、价表刷新、口径说明。
 *
 * 设置快照走宿主真实的 `ctx.settingsScope.bind<T>({ namespace })` 面
 * （`getSnapshot` / `subscribe`，与 plugin-daily-log 的设置分区同一姿态）——
 * 本地再声明一个 `{ get, watch }` 影子契约在宿主里根本不存在。
 * 样式由 client `apply` 经 `ctx.effect` 注入（这里不再重复注入：没有 ctx 可用，
 * 且同一 fiber 注入两次只会多留一个节点）。
 *
 * 三个开关都**真的写**：预算与子代理口径写宿主设置，子代理开关同时写视图 store，
 * 使当前弹窗立即按新口径重取数据（只写一半的话复选框与页面上显示的账会互相打脸）。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import type { BillingScope } from '../core/config.ts'
import { NON_FINITE_PLACEHOLDER } from '../core/format.ts'
import { BackfillLedgerNote } from './backfill-notice.tsx'

export function SettingsSection(props: {
  billing: UsageBillingRemote | undefined
  scope: BillingScope
  store: BillingStore
}): JSX.Element {
  const { billing, scope, store } = props
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const cfg = settings.value
  const [status, setStatus] = useState<{ installAt: number; rows: number; sessions: number } | null>(null)
  const [snapshotId, setSnapshotId] = useState('—')

  useEffect(() => {
    // 远程面首帧可能未挂载：缺席即早退，等 billing 变化后 effect 重跑。
    if (billing === undefined) return
    let alive = true
    void Promise.all([billing.status(), billing.pricing()]).then(([s, p]) => {
      if (!alive) return
      if (s.ok) setStatus(s.value)
      // 取不到不是「0 行」：状态区停在占位（账本 0 行 / 快照 —）并留日志。
      else console.warn('[usage-billing] 账本状态取数失败', s.error)
      if (p.ok) setSnapshotId(p.value.snapshotId)
      else console.warn('[usage-billing] 价表快照取数失败', p.error)
    }).catch((error: unknown) => {
      // wire 层 reject 同理：状态区停在占位，绝不伪造行数或快照 id。
      console.warn('[usage-billing] 设置页取数通道异常', error)
    })
    return () => { alive = false }
  }, [billing])

  /** 写整段 pricing（与 plugin-notes 写 webdav 同姿态）：schema 会用 base 补上未写的字段。 */
  const writeAutoRefresh = useCallback((next: boolean) => {
    void scope.set('pricing', { ...(cfg?.pricing ?? {}), autoRefresh: next })
      .catch(() => { /* 写失败时不回弹：快照仍是 host 的真值 */ })
  }, [scope, cfg])

  /** 预算开关：写宿主设置（`budget.enabled`），账本页的预算条下一帧跟随快照变化。 */
  const writeBudgetEnabled = useCallback((next: boolean) => {
    void scope.set('budget', { ...(cfg?.budget ?? {}), enabled: next })
      .catch(() => { /* 同上 */ })
  }, [scope, cfg])

  /**
   * 子代理口径：写宿主设置（持久）**并**同步视图 store（当前账立即按新口径重取）。
   * 两处都要写：只写 store 刷新页面就丢，只写设置则本次弹窗仍按旧口径取数。
   */
  const writeIncludeSubagents = useCallback((next: boolean) => {
    store.setIncludeSubagents(next)
    void scope.set('display', { ...(cfg?.display ?? {}), includeSubagents: next })
      .catch(() => { /* 同上 */ })
  }, [scope, store, cfg])

  return (
    <section data-dsh-usage-billing>
      <h3>月度预算</h3>
      <label>
        <input type="checkbox" checked={cfg?.budget?.enabled ?? false} disabled={!settings.writable}
          onChange={(e) => { writeBudgetEnabled(e.target.checked) }} /> 启用预算提醒（50% / 80% / 100% 各提醒一次）
      </label>
      {/* 未配置时显示占位而不是「0 元」：0 是一个真实的预算值，与「没设置」不是一回事。 */}
      <div data-dsh-ub-sub>
        预算金额：{cfg?.budget?.monthlyCny === undefined ? NON_FINITE_PLACEHOLDER : `${cfg.budget.monthlyCny} 元`}
        （在「计费」页的费率分区随账本一起查看）
      </div>

      <h3>显示</h3>
      <label>
        <input type="checkbox" checked={cfg?.pricing?.autoRefresh ?? true} disabled={!settings.writable}
          onChange={(e) => { writeAutoRefresh(e.target.checked) }} /> 自动联网刷新价表与汇率（6 小时一次）
      </label>
      <label>
        <input type="checkbox" checked={cfg?.display?.includeSubagents ?? true} disabled={!settings.writable}
          onChange={(e) => { writeIncludeSubagents(e.target.checked) }} /> 统计包含子代理会话
      </label>

      <h3>状态</h3>
      <div data-dsh-ub-sub>
        账本 {status?.rows ?? 0} 行 · 已折叠 {status?.sessions ?? 0} 个会话
      </div>

      <h3>计费口径</h3>
      {/* status 未到（或取数失败）时传 null：说明段渲染占位，绝不把「不知道」印成 1970。
          status 到了但 installAt 不是正数（命名空间里从未落盘）同样按未知处理。 */}
      <BackfillLedgerNote installAt={status === null ? null : status.installAt} snapshotId={snapshotId} />
    </section>
  )
}
