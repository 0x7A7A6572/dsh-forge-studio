/**
 * 智能体团队视图编排（§6.3）：roster + binding → composeStageModel → model/memo 链。
 * 空态分类：未绑定 / 单人绑定 / 等待成员启动（pending）/ 投影不可用（可刷新兜底）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStudioRemote } from '../../core/remote.ts'
import type { StudioMemberRow } from '../../../types.ts'
import type { StudioDetailCapabilities } from '../../core/capabilities.ts'
import type { StudioMemberProfileSnapshot } from '../../core/pixel/detail-model.ts'
import { composeStageModel, type StudioRosterMember } from '../../core/pixel/studio-model.ts'
import type { StudioSharedTaskProjection } from '../../core/pixel/task-model.ts'
import { OFFICE_SCENE } from '../../core/pixel/scene-office.ts'
import {
  applyDebugSandbox,
  consumeDebugMemoReset,
  onDebugChange,
  onDebugStep,
  readDebugFrozen,
  readDebugSandbox,
  readDebugSettings,
  toggleDebugEnabled,
} from '../../core/pixel/debug-bus.ts'
import type { StudioMemo, StudioOccupant, StudioStageModel } from '../../core/pixel/scene-types.ts'
import { queryAtlasAvailable } from '../../hooks/usePixelStage.ts'
import {
  useStudioRoster,
  type StudioProjectionPhase,
  type StudioSessionHooks,
  type StudioSessionsView,
} from '../../hooks/useStudioRoster.ts'
import { useStudioBinding } from '../../hooks/useStudioBinding.ts'

export type StudioEmptyKind = 'unbound' | 'solo' | 'loading' | 'unavailable'

export interface StudioStageProps {
  readonly studio: AgentStudioRemote
  /** 宿主平铺注入的 session 标准包（卡 5 适配组件负责从 ConvViewProps 取出）。 */
  readonly sessionId: string
  readonly useSession: StudioSessionHooks['useSession']
  readonly useSessions: StudioSessionHooks['useSessions']
  readonly useSessionStatus: StudioSessionHooks['useSessionStatus']
  /** 详情卡的宿主能力；缺失时降级为只读浏览。 */
  readonly capabilities: StudioDetailCapabilities
  /**
   * 布局口径：view = 会话正文页签（画布限宽 512、成员列表在右）；
   * pane = 右侧栏正文（画布吃满栏宽、成员列表在下，窄栏不横向溢出）。
   */
  readonly variant?: 'view' | 'pane'
  /** 页签不可见（keepMounted 下被隐藏）时暂停 83ms 重算，可见时恢复。 */
  readonly paused?: boolean
}

export interface StudioStageState {
  readonly model: StudioStageModel | null
  readonly empty: StudioEmptyKind | null
  readonly error: string
  readonly refreshBusy: boolean
  /** 调试叠层开关（Shift+D / URL 参数 / localStorage）。 */
  readonly debugOn: boolean
  /** 点选中的成员；null = 未选中（详情卡关闭）。 */
  readonly selectedId: string | null
  readonly selected: StudioOccupant | null
  readonly selectedProfile: StudioMemberProfileSnapshot | undefined
  /** lead 会话的共享任务板（详情卡两块数据之一；另一块是成员子智能体目录）。 */
  readonly tasks: readonly StudioSharedTaskProjection[]
  select(memberId: string, trigger?: HTMLElement): void
  dismiss(): void
  refresh(): void
}

/** 投影补读的最小间隔：同一成员 1 秒内不重复调用。 */
const REFRESH_INTERVAL_MS = 1_000

/** listRoster 兜底行 → 模型输入成员（status 合成 phase/running）。 */
function membersFromRows(rows: readonly StudioMemberRow[]): readonly StudioRosterMember[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    phase:
      row.status === 'provisioning'
        ? 'provisioning'
        : row.status === 'failed'
          ? 'failed'
          : 'active',
    running: row.status === 'running',
    ...(row.model !== undefined ? { model: row.model } : {}),
    ...(row.status === 'failed' && row.description !== undefined
      ? { error: row.description }
      : {}),
  }))
}

function emptyOf(
  projection: StudioProjectionPhase,
  bindingMode: string | undefined,
  loading: boolean,
  hasRows: boolean,
): StudioEmptyKind | null {
  if (projection === 'ready' || hasRows) return null
  if (projection === 'pending' || loading) return 'loading'
  if (bindingMode === 'team') return 'unavailable'
  return bindingMode === 'solo' ? 'solo' : 'unbound'
}

/** 可见成员：工位内的人 + 候客区可显示的人 + 游走的人（与画布/标签同口径）。 */
function visibleOccupants(model: StudioStageModel): readonly StudioOccupant[] {
  const overflowCapacity = model.overflowMembers[0]?.slot.capacity ?? 0
  return [
    ...model.occupants,
    ...model.overflowMembers.slice(0, overflowCapacity),
    ...model.roamers,
  ]
}

export function useStudioStage(props: StudioStageProps): StudioStageState {
  const { studio, sessionId, capabilities } = props
  const paused = props.paused === true
  // 解构成稳定引用，再组 hooks 对象传给 roster hook。
  const { useSession, useSessions, useSessionStatus } = props
  const sessionHooks = useMemo<StudioSessionHooks>(
    () => ({ useSession, useSessions, useSessionStatus }),
    [useSession, useSessions, useSessionStatus],
  )
  const roster = useStudioRoster(sessionId, sessionHooks)
  const binding = useStudioBinding(studio, roster.leadId)

  // 投影只有 name，用 name → profile 一对一映射补 model。
  const effectiveMembers = useMemo(() => {
    if (roster.projection !== 'ready') {
      return binding.rosterRows !== null ? membersFromRows(binding.rosterRows) : []
    }
    return roster.members.map((member) => {
      const profile = binding.profiles.find((p) => p.name === member.name)
      return {
        ...member,
        ...(profile?.model !== undefined && profile.model !== null
          ? { model: profile.model.model }
          : {}),
      }
    })
  }, [roster.projection, roster.members, binding.profiles, binding.rosterRows])

  const memoRef = useRef<StudioMemo>({})
  const [recalcTick, setRecalcTick] = useState(0)
  const [model, setModel] = useState<StudioStageModel | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [debugOn, setDebugOn] = useState(() => readDebugSettings().enabled)
  /** 调试侧任何变更（设置/沙盒/重置）都推一版，驱动模型重算与空态豁免。 */
  const [debugVersion, setDebugVersion] = useState(0)
  /** 关闭详情时焦点要回到的热区按钮。 */
  const triggerRef = useRef<HTMLElement | null>(null)
  const lastRefreshRef = useRef<Readonly<Record<string, number>>>({})

  useEffect(() => {
    return onDebugChange(() => {
      setDebugOn(readDebugSettings().enabled)
      setDebugVersion((value) => value + 1)
      if (consumeDebugMemoReset()) memoRef.current = {}
    })
  }, [])

  // Shift+D 开关调试叠层：输入控件里不拦截；多实例同挂时只让首个监听生效。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.shiftKey && event.key === 'D')) return
      const target = event.target as HTMLElement | null
      if (
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (event.defaultPrevented) return
      event.preventDefault()
      toggleDebugEnabled()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    const sandboxMembers = applyDebugSandbox(effectiveMembers)
    const sandboxActive = readDebugSandbox().extra.length > 0
    // 实验沙盒有模拟成员时豁免投影守卫：未绑定团队的会话也能进沙盒调动画。
    if (!sandboxActive && roster.projection !== 'ready' && binding.rosterRows === null) {
      setModel(null)
      return
    }
    // P1-2：compose 时现取 performance.now()，保证 done 边沿的窗口新鲜；
    // recalcTick 只是「到点重算」的触发器。
    void recalcTick
    const reducedMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = composeStageModel({
      roster: sandboxMembers,
      scene: OFFICE_SCENE,
      atlasAvailable: queryAtlasAvailable(),
      now: performance.now(),
      memo: memoRef.current,
      reducedMotion,
    })
    memoRef.current = next.memo
    setModel(next)
  }, [effectiveMembers, roster.projection, binding.rosterRows, recalcTick, debugVersion])

  // 成员会话投影可能从未读过：进面板时按需补读一次（1 秒内不重试）。
  const memberKey = effectiveMembers.map((member) => member.id).join('|')
  const projections = useSessions(
    (snapshot) => (snapshot as StudioSessionsView | undefined)?.projectionsBySession,
  )
  useEffect(() => {
    if (memberKey === '') return
    const stamp = Date.now()
    const answered: Record<string, number> = {}
    for (const id of memberKey.split('|')) {
      const state = projections?.[id]?.state
      if (state !== undefined && state !== 'idle') continue
      if (stamp - (lastRefreshRef.current[id] ?? 0) < REFRESH_INTERVAL_MS) continue
      answered[id] = stamp
      capabilities.refreshProjections?.(id)
    }
    if (Object.keys(answered).length > 0) {
      lastRefreshRef.current = { ...lastRefreshRef.current, ...answered }
    }
  }, [memberKey, projections, capabilities])

  // done 窗口到期需要一次重算让成员回落 idle（淡出 alpha 由渲染层按 now 呈现）。
  useEffect(() => {
    const expiries = Object.values(model?.memo.doneUntil ?? {}) as number[]
    if (expiries.length === 0) return
    const earliest = Math.min(...expiries)
    const delay = Math.max(0, earliest - performance.now()) + 1
    const timer = window.setTimeout(() => setRecalcTick((value) => value + 1), delay)
    return () => window.clearTimeout(timer)
  }, [model])

  // 游走推进（卡 16）：~12fps 重算模型（foot/memo 每帧前进；与 canvas RAF 同频）。
  // 页签不可见时停表：keepMounted 下仍挂载，但没必要为看不见的画面算。
  // 调试冻结时也停表；「步进」经 onDebugStep 恰好重算一帧。
  useEffect(() => {
    if (paused) return
    const timer = window.setInterval(() => {
      if (readDebugFrozen()) return
      setRecalcTick((value) => value + 1)
    }, 83)
    return () => window.clearInterval(timer)
  }, [paused])

  useEffect(() => {
    return onDebugStep(() => {
      if (!readDebugFrozen()) return
      setRecalcTick((value) => value + 1)
    })
  }, [])

  const dismiss = useCallback(() => {
    setSelectedId(null)
    const trigger = triggerRef.current
    triggerRef.current = null
    if (trigger === null || !trigger.isConnected) return
    // 等 dialog 卸载提交后再还焦点，避免焦点落回即将被移除的节点。
    window.setTimeout(() => {
      if (trigger.isConnected) trigger.focus()
    }, 0)
  }, [])
  const select = useCallback((memberId: string, trigger?: HTMLElement) => {
    if (trigger !== undefined) triggerRef.current = trigger
    if (selectedId === memberId) {
      dismiss()
      return
    }
    setSelectedId(memberId)
  }, [dismiss, selectedId])

  const selected = useMemo(() => {
    if (model === null || selectedId === null) return null
    return visibleOccupants(model).find((occupant) => occupant.memberId === selectedId) ?? null
  }, [model, selectedId])

  // 成员被移出团队时收起详情卡。
  useEffect(() => {
    if (selectedId === null || selected !== null) return
    triggerRef.current = null
    setSelectedId(null)
  }, [selectedId, selected])

  const selectedProfile = useMemo<StudioMemberProfileSnapshot | undefined>(() => {
    if (selected === null) return undefined
    const profile = binding.profiles.find((p) => p.name === selected.name)
    const row = binding.rosterRows?.find((r) => r.name === selected.name)
    const description = profile?.description ?? row?.description
    const provider = profile?.model?.provider
    const profileModel = profile?.model?.model
    if (description === undefined && provider === undefined && profileModel === undefined) {
      return undefined
    }
    return {
      ...(description !== undefined ? { description } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(profileModel !== undefined ? { model: profileModel } : {}),
    }
  }, [selected, binding.profiles, binding.rosterRows])

  // 实验沙盒有模拟成员时豁免空态：模型仍在（compose 侧同样豁免投影守卫）。
  const sandboxActive = readDebugSandbox().extra.length > 0
  const empty = sandboxActive
    ? null
    : emptyOf(
        roster.projection,
        binding.binding?.mode,
        binding.loading,
        binding.rosterRows !== null,
      )
  return {
    model: empty === null ? model : null,
    empty,
    error: binding.error,
    refreshBusy: binding.rosterLoading,
    debugOn,
    selectedId,
    selected,
    selectedProfile,
    tasks: roster.tasks,
    select,
    dismiss,
    refresh: binding.refreshRoster,
  }
}
