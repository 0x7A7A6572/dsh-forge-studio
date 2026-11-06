/**
 * 成员详情取数：会话投影（title/令牌/时长/子任务目录）+ 一次投影补读。
 * 目录行映射在 core/pixel/detail-model.ts，这里只负责选择与生命周期。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { StudioDetailCapabilities } from '../core/capabilities.ts'
import {
  mapCatalogRows,
  type StudioCatalogEntry,
  type StudioCatalogView,
} from '../core/pixel/detail-model.ts'
import {
  activityDurationMs,
  formatDuration,
  formatTokenUsage,
  type StudioCatalogMode,
  type StudioSubagentTiming,
  type StudioTokenUsage,
} from '../core/pixel/text-format.ts'
import {
  mapSharedTaskRows,
  type StudioSharedTaskProjection,
  type StudioTaskRow,
} from '../core/pixel/task-model.ts'

/** 本面板消费的两个标准 hook（宿主按 scope 注入）。 */
export interface StudioDetailHooks {
  readonly useSessions: SnapshotSelectorHook<unknown>
  readonly useSessionStatus: SnapshotSelectorHook<unknown>
}

export interface StudioMemberProjectionValues {
  readonly tokenUsage?: StudioTokenUsage
  readonly subagentTiming?: StudioSubagentTiming
  readonly subagentCatalog?: readonly StudioCatalogEntry[]
  readonly modelSelection?: {
    readonly next?: { readonly provider?: string; readonly model?: string } | null
  } | null
}

/** 会话 byId 行里详情卡读取的字段。 */
export interface StudioDetailSummary {
  readonly title?: string
  readonly running?: boolean
  readonly projectionValues?: StudioMemberProjectionValues
}

/** projectionsBySession 值的最小切片。 */
export interface StudioMemberProjectionView {
  readonly state?: string
  readonly error?: { readonly message?: string }
  readonly values?: StudioMemberProjectionValues
}

export interface StudioDetailSessionsView {
  readonly byId?: Readonly<Record<string, StudioDetailSummary | undefined>>
  readonly projectionsBySession?: Readonly<Record<string, StudioMemberProjectionView | undefined>>
}

/** useSessionStatus 快照的最小切片。 */
export interface StudioDetailStatusView {
  get(id: string): { readonly running?: boolean } | undefined
}

export interface StudioMemberDetailInput {
  readonly memberId: string
  /** 成员名：共享任务按 ownerName 归属过滤（TeamTaskView 无 ownerId）。 */
  readonly memberName: string
  /** lead 卡显示全部共享任务并标注 owner；成员卡只看自己的。 */
  readonly isLead: boolean
  /** lead 会话 agentTeam 投影的共享任务板（useStudioStage 从 roster 传入）。 */
  readonly tasks?: readonly StudioSharedTaskProjection[]
  readonly hooks: StudioDetailHooks
  readonly capabilities: StudioDetailCapabilities
  onClose(): void
}

export interface StudioMemberDetailState {
  readonly title?: string
  readonly model?: string
  readonly provider?: string
  readonly tokensText?: string
  readonly durationText?: string
  /** 成员投影读取失败的原因；空串 = 无错误。 */
  readonly error: string
  /** 共享任务：成员卡按 ownerName 过滤；lead 卡为全部（带 owner）。 */
  readonly sharedTasks: readonly StudioTaskRow[]
  /** lead 卡才显示任务 owner 列。 */
  readonly showTaskOwner: boolean
  readonly catalog: StudioCatalogView
  readonly canOpen: boolean
  readonly canRetry: boolean
  openTask(taskId: string, mode: StudioCatalogMode): void
  retry(): void
}

/** 投影补读的最小间隔：同一成员 1 秒内不重复调用。 */
const REFRESH_INTERVAL_MS = 1_000

/** 打开一条 running 任务时 1 秒重算活跃时长。 */
const TICK_INTERVAL_MS = 1_000

/** 一次补读后仍没有 catalog 的等待上限；超时把 loading 升级成可重试的 error。 */
const CATALOG_STALL_MS = 3_000
const CATALOG_STALL_MESSAGE = '子智能体会话读取超时，可以重试'

export function useStudioMemberDetail(input: StudioMemberDetailInput): StudioMemberDetailState {
  const { memberId, memberName, isLead, capabilities, onClose } = input
  const { useSessions, useSessionStatus } = input.hooks

  const summary = useSessions(
    (snapshot) => (snapshot as StudioDetailSessionsView | undefined)?.byId?.[memberId],
  )
  const projection = useSessions(
    (snapshot) => (snapshot as StudioDetailSessionsView | undefined)?.projectionsBySession?.[memberId],
  )
  const summaries = useSessions((snapshot) => (snapshot as StudioDetailSessionsView | undefined)?.byId)
  const statuses = useSessionStatus((snapshot) => snapshot) as StudioDetailStatusView | undefined

  const [now, setNow] = useState<number>(() => Date.now())
  const [retryCount, setRetryCount] = useState(0)
  const lastRefresh = useRef<Readonly<Record<string, number>>>({})

  useEffect(() => {
    const stamp = Date.now()
    if (stamp - (lastRefresh.current[memberId] ?? 0) < REFRESH_INTERVAL_MS) return
    lastRefresh.current = { ...lastRefresh.current, [memberId]: stamp }
    capabilities.refreshProjections?.(memberId)
  }, [memberId, capabilities])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const running = statuses?.get(memberId)?.running ?? summary?.running
  const baseCatalog = useMemo(
    () => mapCatalogRows({
      // catalog 与 state/error 同源（projectionsBySession），token/耗时仍走 byId。
      entries: projection?.values?.subagentCatalog,
      state: projection?.state,
      errorMessage: projection?.error?.message,
      summaries,
      statuses,
      now,
    }),
    [projection, summaries, statuses, now],
  )
  // 补读一次后仍停在 loading：升级成可重试的错误，避免无限加载。
  const waitingForCatalog = baseCatalog.phase === 'loading' && baseCatalog.rows.length === 0
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (!waitingForCatalog) {
      setStalled(false)
      return
    }
    setStalled(false)
    const timer = window.setTimeout(() => setStalled(true), CATALOG_STALL_MS)
    return () => window.clearTimeout(timer)
  }, [waitingForCatalog, memberId, retryCount])
  const catalog = useMemo<StudioCatalogView>(
    () => (stalled && waitingForCatalog
      ? { ...baseCatalog, phase: 'error', errorMessage: CATALOG_STALL_MESSAGE }
      : baseCatalog),
    [baseCatalog, stalled, waitingForCatalog],
  )
  const ticking = running === true || catalog.running
  useEffect(() => {
    if (!ticking) return
    const timer = window.setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [ticking])

  // 共享任务与子智能体目录是两个数据源：这里只按 ownerName 过滤 agentTeam.tasks，
  // 不从 catalog 补任何行（任务不是会话，会话也不进任务板）。
  const sharedTasks = useMemo(
    () => mapSharedTaskRows({
      tasks: input.tasks,
      ownerName: memberName,
      showAll: isLead,
    }),
    [input.tasks, memberName, isLead],
  )

  const timing = summary?.projectionValues?.subagentTiming
  const durationMs = activityDurationMs(timing, running === true ? 'running' : 'inactive', now)
  const tokensText = formatTokenUsage(summary?.projectionValues?.tokenUsage)
  const selection = projection?.values?.modelSelection?.next
  const title = summary?.title
  const model = selection?.model
  const provider = selection?.provider

  const openTask = useCallback((taskId: string, mode: StudioCatalogMode): void => {
    if (!capabilities.hasOpenSession) return
    capabilities.openSession?.({
      parentSessionId: memberId,
      childSessionId: taskId,
      mode: mode === 'continuable' ? 'continuable' : mode === 'one-shot' ? 'one-shot' : 'unknown',
    })
  }, [capabilities, memberId])

  const retry = useCallback((): void => {
    capabilities.refreshProjections?.(memberId)
    setRetryCount((value) => value + 1)
    setNow(Date.now())
  }, [capabilities, memberId])

  return {
    ...(title !== undefined ? { title } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(tokensText !== undefined ? { tokensText } : {}),
    ...(durationMs !== undefined ? { durationText: formatDuration(durationMs) } : {}),
    error: projection?.error?.message ?? '',
    sharedTasks,
    showTaskOwner: isLead,
    catalog,
    canOpen: capabilities.hasOpenSession,
    canRetry: capabilities.hasRefreshProjections,
    openTask,
    retry,
  }
}
