import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { BillingStore, TabId } from '../../core/store.ts'
import type { BillingConfigLike, BillingScope } from '../../core/config.ts'
import { entryFlagsOf } from '../../core/config.ts'
import { NON_FINITE_PLACEHOLDER } from '../../core/format.ts'
import { overviewKey } from '../../core/query.ts'
import type { QueryCache } from '../../core/query.ts'
import type { Revalidator } from '../../core/revalidate.ts'
import type { ThemeRegistry } from '../../core/theme-registry.ts'
import type { ThemeFailureStore } from '../../core/themes/failures.ts'
import { useRevision } from '../../hooks/useRevision.ts'
import { evaluateBudget } from '../../../budget.ts'
import type { EntryKey } from '../../../types.ts'

export interface SettingsSectionProps {
  billing: UsageBillingRemote | undefined
  scope: BillingScope
  store: BillingStore
  /** 与入口卡共用同一份 overview：同拍重复请求合并。 */
  query: QueryCache
  /** 自动重取心跳（按 fiber 创建，见 core/revalidate.ts）。 */
  revalidate: Revalidator
  /** 侧栏入口的主题集合：设置页用它列出可用主题。 */
  themes: ThemeRegistry
  /** 主题装载失败列表（扫到了但转译不过去的主题）。 */
  failures: ThemeFailureStore
}

/** 用量模块常驻在页签之上，页签只含配置类内容。 */
export type SettingsTabId = 'config' | 'pricing' | 'other'

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTabId; label: string }> = [
  { id: 'config', label: '配置' },
  { id: 'pricing', label: '价表' },
  { id: 'other', label: '其他配置' },
]

/** false = 写入被拒（不是抛异常）；拒绝与传输异常都只记日志。 */
function writeConfig(run: () => Promise<boolean>): void {
  void run().then((ok) => {
    if (!ok) console.warn('[usage-billing] 配置写入被拒绝（当前没有写权限）')
  }).catch((error: unknown) => {
    console.warn('[usage-billing] 配置写入失败', error)
  })
}

export interface LedgerStatus {
  installAt: number
  rows: number
  sessions: number
  snapshots: number
  /** 账本摊成的分片记录数；只做诊断，界面不展示。 */
  shards: number
  /** 正在重建：这些数字还在长，不是最终值。 */
  rebuild: { active: boolean }
}

/** 跨档提醒（tier 是 1..3 的档位序号，pct 是当月已用比例）。 */
export interface BudgetNoticeState {
  tier: 1 | 2 | 3
  pct: number
}

export function useSettingsSection(props: SettingsSectionProps) {
  const { billing, scope, store, query, revalidate } = props
  // 心跳驱动用量视图与跨档提醒重取；账本状态与价表是快照，不跟心跳。
  const revision = useRevision(revalidate)
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
  const [view, setView] = useState<TabId>('overview')
  const [tab, setTab] = useState<SettingsTabId>('config')
  /**
   * 只增不减：首次选中才挂载，之后一直挂着只隐藏，
   * 于是切页签不丢卡片开合与价表排序。
   */
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SettingsTabId>>(
    () => new Set<SettingsTabId>(['config']),
  )
  /**
   * 概览 / 趋势 / 明细是条件渲染，状态留在视图里会被重新挂载抹掉，
   * 所以折叠状态留在本 hook 里。
   */
  const [activityOpen, setActivityOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  /** 本次跨档提醒（本地态：落盘后 shouldNotify 变 null，提醒要留在屏幕上）。 */
  const [budgetNotice, setBudgetNotice] = useState<BudgetNoticeState | null>(null)
  /** 预算金额草稿：`null` = 没在编辑，输入框直接显示快照真值。 */
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null)
  const budgetText = cfg?.budget?.monthlyCny === undefined ? '' : String(cfg.budget.monthlyCny)

  useEffect(() => {
    // 远程面首帧可能未挂载：缺席即早退，等 billing 变化后 effect 重跑。
    if (billing === undefined) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (): void => {
      void Promise.all([billing.status(), billing.pricing()]).then(([s, p]) => {
        if (!alive) return
        if (s.ok) {
          setStatus(s.value)
          // 重建是分钟级的：还在重建就每 3s 再看一眼，落定后自然不再排下一拍。
          if (s.value.rebuild.active) timer = setTimeout(load, 3000)
        }
        // 取不到不是「0 行」：状态区停在占位（账本 0 行 / 快照 —）并留日志。
        else console.warn('[usage-billing] 账本状态取数失败', s.error)
        if (p.ok) setSnapshotId(p.value.snapshotId)
        else console.warn('[usage-billing] 价表快照取数失败', p.error)
      }).catch((error: unknown) => {
        console.warn('[usage-billing] 设置页取数通道异常', error)
      })
    }
    load()
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer) }
  }, [billing])

  // 快照一变就交还草稿：写成功、写失败、被别处改掉都显示宿主真值。
  useEffect(() => { setBudgetDraft(null) }, [budgetText])

  useEffect(() => {
    setVisitedTabs((previous) => (previous.has(tab) ? previous : new Set([...previous, tab])))
  }, [tab])

  /**
   * notices 的唯一写缝：基数必须在写入时刻从快照现取，不能用渲染捕获的 cfg.notices
   * 两个写者写同一字段的不同子键，陈旧基数展开会抹掉对方刚写的。
   * 另用写队列串起「读基数 → 写回」：宿主同命名空间的写入是排队结算的。
   */
  const noticesQueue = useRef<Promise<void>>(Promise.resolve())
  const writeNotices = useCallback((patch: Partial<BillingConfigLike['notices']>): Promise<void> => {
    // 先吞掉队列自身的失败，否则一次写失败会让整条链 rejected 再也排不上。
    const run = noticesQueue.current.catch(() => undefined).then(() => {
      const notices = scope.getSnapshot().value?.notices ?? { backfillDismissed: false, budgetNotified: {} }
      return scope.set('notices', { ...notices, ...patch }).then((ok) => {
        // 拒绝不算「已关」：快照没变，提示条下次进这一页还会出现。
        if (!ok) console.warn('[usage-billing] notices 写入被拒绝（当前没有写权限）')
      }).catch((error: unknown) => {
        console.warn('[usage-billing] notices 写入失败', error)
      })
    })
    noticesQueue.current = run
    return run
  }, [scope])

  const dismissBackfill = useCallback(() => {
    void writeNotices({ backfillDismissed: true })
  }, [writeNotices])

  useEffect(() => {
    if (billing === undefined || cfg === undefined) return
    let alive = true
    void query.run(overviewKey('month', includeSubagents), () => billing.overview('month', includeSubagents)).then((r) => {
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
    }).catch(() => { /* 取数通道异常：不提醒，也不留 unhandled rejection */ })
    return () => { alive = false }
  }, [billing, includeSubagents, scope, cfg, writeNotices, revision, query])

  const dismissBudgetNotice = useCallback(() => { setBudgetNotice(null) }, [])

  const toggleActivity = useCallback(() => { setActivityOpen((previous) => !previous) }, [])
  const toggleModels = useCallback(() => { setModelsOpen((previous) => !previous) }, [])

  /** 写整段 pricing：未写的字段由 schema 的 base 补上。 */
  const writeAutoRefresh = useCallback((next: boolean) => {
    writeConfig(() => scope.set('pricing', { ...(cfg?.pricing ?? {}), autoRefresh: next }))
  }, [scope, cfg])

  const writeBudgetEnabled = useCallback((next: boolean) => {
    writeConfig(() => scope.set('budget', { ...(cfg?.budget ?? {}), enabled: next }))
  }, [scope, cfg])

  /** 子代理口径两处都写：settings 持久，store 让当前账立即重取。 */
  const writeIncludeSubagents = useCallback((next: boolean) => {
    store.setIncludeSubagents(next)
    writeConfig(() => scope.set('display', { ...(cfg?.display ?? {}), includeSubagents: next }))
  }, [scope, store, cfg])

  /** 峰谷时段图开关：只负责写，画不画由弹窗侧的 useShowTierCurve 判。 */
  const writeShowTierCurve = useCallback((next: boolean) => {
    writeConfig(() => scope.set('display', { ...(cfg?.display ?? {}), showTierCurve: next }))
  }, [scope, cfg])

  /** 两个开关一起落盘：只写一个会留下「开关半个在位」的中间态。 */
  const writeEntry = useCallback((key: EntryKey, next: boolean) => {
    const flags = entryFlagsOf(cfg)
    writeConfig(() => scope.set('display', {
      ...(cfg?.display ?? {}),
      entrySidebar: key === 'sidebar' ? next : flags.sidebar,
      entryComposer: key === 'composer' ? next : flags.composer,
    }))
  }, [scope, cfg])

  const writeSidebarEntry = useCallback((next: boolean) => { writeEntry('sidebar', next) }, [writeEntry])
  const writeComposerEntry = useCallback((next: boolean) => { writeEntry('composer', next) }, [writeEntry])

  /**
   * 提交预算金额（失焦或回车）：只接受有限正数，0 在 budget.ts 里等于「无预算」，
   * 空值 / 0 / 负数 / 非数字一律不落盘并回弹快照真值。
   */
  const commitBudget = useCallback(() => {
    if (budgetDraft === null) return
    const raw = budgetDraft.trim()
    const parsed = Number(raw)
    if (raw === '' || !Number.isFinite(parsed) || parsed <= 0) { setBudgetDraft(null); return }
    if (parsed === cfg?.budget?.monthlyCny) { setBudgetDraft(null); return }
    // 先显示已提交值，等快照回来再交还：否则写往返期间会闪回旧金额。
    setBudgetDraft(String(parsed))
    void scope.set('budget', { ...(cfg?.budget ?? {}), monthlyCny: parsed })
      .then((ok) => { if (!ok) setBudgetDraft(null) })
      .catch((error: unknown) => {
        console.warn('[usage-billing] 预算写入失败', error)
        setBudgetDraft(null)
      })
  }, [scope, cfg, budgetDraft])

  /** 回车提交；这里不 blur —— 会再触发一次提交，同一拍读到的还是旧 prop。 */
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
    tab,
    setTab,
    visitedTabs,
    activityOpen,
    modelsOpen,
    toggleActivity,
    toggleModels,
    budgetNotice,
    dismissBudgetNotice,
    dismissBackfill,
    backfillDismissed: cfg?.notices?.backfillDismissed === true,
    commitBudget,
    onBudgetKeyDown,
    writeAutoRefresh,
    writeBudgetEnabled,
    writeIncludeSubagents,
    writeShowTierCurve,
    writeSidebarEntry,
    writeComposerEntry,
  }
}
