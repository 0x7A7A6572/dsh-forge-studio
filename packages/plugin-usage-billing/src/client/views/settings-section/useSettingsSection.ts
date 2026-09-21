/**
 * 设置页的全部状态与动作：预算、显示偏好、价表刷新、用量视图（概览 / 趋势 / 明细）、
 * 预算跨档提醒与回填提示条。
 *
 * 设置快照走宿主真实的 `ctx.settingsScope.bind<T>({ namespace })` 面
 * （`getSnapshot` / `subscribe`，与 plugin-daily-log / plugin-memory 同一姿态）——
 * 本地再声明一个 `{ get, watch }` 影子契约在宿主里根本不存在。
 *
 * 计费弹窗取消后，原来挂在弹窗上的两件事（跨档提醒、回填提示条）搬到这里：判定时机从
 * 「面板真的打开」变成「这一页真的被看到」，语义没变（没被看到的提醒不该被记成已提醒）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { BillingStore, TabId } from '../../core/store.ts'
import type { BillingConfigLike, BillingScope } from '../../core/config.ts'
import { entryFlagsOf } from '../../core/config.ts'
import { NON_FINITE_PLACEHOLDER } from '../../core/format.ts'
import { evaluateBudget } from '../../../budget.ts'
import type { EntryKey } from '../../../types.ts'

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

/** 跨档提醒（tier 是 1..3 的档位序号，pct 是当月已用比例）。 */
export interface BudgetNoticeState {
  tier: 1 | 2 | 3
  pct: number
}

export function useSettingsSection(props: SettingsSectionProps) {
  const { billing, scope, store } = props
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const includeSubagents = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().includeSubagents,
  )
  const cfg = settings.value
  const [status, setStatus] = useState<LedgerStatus | null>(null)
  const [snapshotId, setSnapshotId] = useState(NON_FINITE_PLACEHOLDER)
  /** 页内用量视图：弹窗没了，概览 / 趋势 / 明细现在是这一页的三选一。 */
  const [view, setView] = useState<TabId>('overview')
  /** 本次跨档的提醒（本地态：落盘后 `shouldNotify` 就变 null 了，提醒本身要留在屏幕上）。 */
  const [budgetNotice, setBudgetNotice] = useState<BudgetNoticeState | null>(null)
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

  /**
   * `notices` 的唯一写缝（回填提示条关闭 / 预算跨档标记共用它）。基数必须在**写入时刻**
   * 从快照现取，绝不能用本次渲染捕获的 `cfg.notices`：两个写者写的是同一字段的不同子键，
   * 各自的渲染快照可能都停在对方写入落地之前，用陈旧基数展开会把对方刚写的子键抹掉。
   * 另用一条写队列把「读基数 → 写回」串起来（宿主对同一命名空间的写入是排队结算的）。
   */
  const noticesQueue = useRef<Promise<void>>(Promise.resolve())
  const writeNotices = useCallback((patch: Partial<BillingConfigLike['notices']>): Promise<void> => {
    // 队列自身必须被吞掉失败，否则一次写失败会让整条链变成 rejected，后续写入再也排不上。
    const run = noticesQueue.current.catch(() => undefined).then(() => {
      const notices = scope.getSnapshot().value?.notices ?? { backfillDismissed: false, budgetNotified: {} }
      return scope.set('notices', { ...notices, ...patch }).catch(() => {
        /* 写失败时不本地妥协：快照仍是 host 的真值 */
      })
    })
    noticesQueue.current = run
    return run
  }, [scope])

  /** 一次性关闭：写回宿主 notices（快照更新后提示条永久消失）。 */
  const dismissBackfill = useCallback(() => {
    void writeNotices({ backfillDismissed: true })
  }, [writeNotices])

  /**
   * 预算跨档提醒：数据用 `overview('month')`（预算本来就是月度口径），「已提醒」写进
   * 设置 `notices.budgetNotified`。`overview` 取数失败就不提醒 —— 宁可不说，
   * 也不能凭一个坏读报一个假档位。
   */
  useEffect(() => {
    if (billing === undefined || cfg === undefined) return
    let alive = true
    void billing.overview('month', includeSubagents).then((r) => {
      if (!alive || !r.ok) return
      const monthKey = r.value.todayKey.slice(0, 7)
      const notified = cfg.notices?.budgetNotified ?? {}
      const spend = evaluateBudget({
        spentCny: r.value.overview.totalCny, monthlyCny: r.value.budget.monthlyCny,
        enabled: r.value.budget.enabled, notified, monthKey,
      })
      if (spend.shouldNotify === null) return
      setBudgetNotice({ tier: spend.shouldNotify, pct: spend.pct })
      void writeNotices({ budgetNotified: { ...notified, [monthKey]: String(spend.shouldNotify) } })
    }).catch(() => { /* 取数通道异常：不提醒，也不制造 unhandled rejection */ })
    return () => { alive = false }
  }, [billing, includeSubagents, scope, cfg, writeNotices])

  const dismissBudgetNotice = useCallback(() => { setBudgetNotice(null) }, [])

  /** 写整段 pricing（与 plugin-notes 写 webdav 同姿态）：schema 会用 base 补上未写的字段。 */
  const writeAutoRefresh = useCallback((next: boolean) => {
    void scope.set('pricing', { ...(cfg?.pricing ?? {}), autoRefresh: next })
      .catch(() => { /* 写失败时不回弹：快照仍是 host 的真值 */ })
  }, [scope, cfg])

  /** 预算开关：写宿主设置（`budget.enabled`），入口的进度条下一帧跟随快照变化。 */
  const writeBudgetEnabled = useCallback((next: boolean) => {
    void scope.set('budget', { ...(cfg?.budget ?? {}), enabled: next })
      .catch(() => { /* 同上 */ })
  }, [scope, cfg])

  /**
   * 子代理口径：写宿主设置（持久）**并**同步视图 store（当前账立即按新口径重取）。
   * 两处都要写：只写 store 刷新页面就丢，只写设置则页面上这一轮仍按旧口径取数。
   */
  const writeIncludeSubagents = useCallback((next: boolean) => {
    store.setIncludeSubagents(next)
    void scope.set('display', { ...(cfg?.display ?? {}), includeSubagents: next })
      .catch(() => { /* 同上 */ })
  }, [scope, store, cfg])

  /**
   * 入口开关：写宿主设置（持久）。两个开关各自独立，两个入口组件订阅同一份快照，
   * 谁渲染由 `entryFlagsOf` 收敛 —— 这里只负责写，且每次都把两个开关一起落盘，
   * 让「旧落点」那一路彻底让位（只写一个会出现「开关半个在位」的中间态）。
   */
  const writeEntry = useCallback((key: EntryKey, next: boolean) => {
    const flags = entryFlagsOf(cfg)
    void scope.set('display', {
      ...(cfg?.display ?? {}),
      entrySidebar: key === 'sidebar' ? next : flags.sidebar,
      entryComposer: key === 'composer' ? next : flags.composer,
    }).catch(() => { /* 同上 */ })
  }, [scope, cfg])

  const writeSidebarEntry = useCallback((next: boolean) => { writeEntry('sidebar', next) }, [writeEntry])
  const writeComposerEntry = useCallback((next: boolean) => { writeEntry('composer', next) }, [writeEntry])

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
    writable: settings.writable,
    entries: entryFlagsOf(cfg),
    view,
    setView,
    budgetNotice,
    dismissBudgetNotice,
    dismissBackfill,
    backfillDismissed: cfg?.notices?.backfillDismissed === true,
    commitBudget,
    onBudgetKeyDown,
    writeAutoRefresh,
    writeBudgetEnabled,
    writeIncludeSubagents,
    writeSidebarEntry,
    writeComposerEntry,
  }
}
