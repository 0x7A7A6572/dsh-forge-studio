/**
 * 设置页的全部状态与动作：预算、显示偏好、价表刷新。
 *
 * 设置快照走宿主真实的 `ctx.settingsScope.bind<T>({ namespace })` 面
 * （`getSnapshot` / `subscribe`，与 plugin-daily-log / plugin-memory 同一姿态）——
 * 本地再声明一个 `{ get, watch }` 影子契约在宿主里根本不存在。
 *
 * 四个开关都**真的写**：预算与显示口径写宿主设置，子代理开关同时写视图 store，
 * 使当前弹窗立即按新口径重取数据（只写一半的话开关与页面上的账会互相打脸）。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { BillingStore } from '../../core/store.ts'
import type { BillingScope } from '../../core/config.ts'
import { NON_FINITE_PLACEHOLDER } from '../../core/format.ts'

export interface SettingsSectionProps {
  billing: UsageBillingRemote | undefined
  scope: BillingScope
  store: BillingStore
}

export interface LedgerStatus {
  installAt: number
  rows: number
  sessions: number
  snapshots: number
}

export function useSettingsSection(props: SettingsSectionProps) {
  const { billing, scope, store } = props
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const cfg = settings.value
  const [status, setStatus] = useState<LedgerStatus | null>(null)
  const [snapshotId, setSnapshotId] = useState(NON_FINITE_PLACEHOLDER)
  /** 预算金额草稿：`null` = 没在编辑，输入框直接显示快照真值。 */
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null)
  const budgetText = cfg?.budget?.monthlyCny === undefined ? '' : String(cfg.budget.monthlyCny)

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

  // 快照一变就把输入交还给快照：写成功、写失败、或被别处改掉，显示的都是宿主真值。
  useEffect(() => { setBudgetDraft(null) }, [budgetText])

  /** 写整段 pricing（与 plugin-notes 写 webdav 同姿态）：schema 会用 base 补上未写的字段。 */
  const writeAutoRefresh = useCallback((next: boolean) => {
    void scope.set('pricing', { ...(cfg?.pricing ?? {}), autoRefresh: next })
      .catch(() => { /* 写失败时不回弹：快照仍是 host 的真值 */ })
  }, [scope, cfg])

  /** 预算开关：写宿主设置（`budget.enabled`），弹窗里的预算条下一帧跟随快照变化。 */
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

  /**
   * 未收录提示条开关：只关掉概览页那条解释性文案；未收录的计数与徽标是事实，永远保留
   * （关掉「提醒」不等于把「未知」当成「没有」）。
   */
  const writeShowUnpricedWarning = useCallback((next: boolean) => {
    void scope.set('display', { ...(cfg?.display ?? {}), showUnpricedWarning: next })
      .catch(() => { /* 同上 */ })
  }, [scope, cfg])

  /**
   * 提交预算金额（失焦或回车）。**不在 onChange 里写**：敲 `300` 会依次写 `3` / `30` / `300`，
   * 每一笔都会拿中间值去判一次跨档提醒。只接受有限正数 —— 空值 / 0 / 负数 / 非数字一律
   * 不落盘并回弹到快照真值（0 会被 `budget.ts` 当成「无预算」，写进去等于把预算悄悄关掉）。
   */
  const commitBudget = useCallback(() => {
    if (budgetDraft === null) return
    const raw = budgetDraft.trim()
    const parsed = Number(raw)
    if (raw === '' || !Number.isFinite(parsed) || parsed <= 0) { setBudgetDraft(null); return }
    if (parsed === cfg?.budget?.monthlyCny) { setBudgetDraft(null); return }
    // 先显示已提交值，等宿主快照回来再交还控制权：否则写往返期间会闪回旧金额。
    setBudgetDraft(String(parsed))
    void scope.set('budget', { ...(cfg?.budget ?? {}), monthlyCny: parsed })
      .catch(() => { setBudgetDraft(null) })
  }, [scope, cfg, budgetDraft])

  /** 回车提交；**不顺手 blur** —— blur 会再触发一次提交，同一拍里读到的还是旧 prop，会写两遍。 */
  const onBudgetKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commitBudget()
  }, [commitBudget])

  return {
    cfg,
    status,
    snapshotId,
    budgetDraft,
    setBudgetDraft,
    budgetText,
    locked: !settings.writable,
    commitBudget,
    onBudgetKeyDown,
    writeAutoRefresh,
    writeBudgetEnabled,
    writeIncludeSubagents,
    writeShowUnpricedWarning,
  }
}
