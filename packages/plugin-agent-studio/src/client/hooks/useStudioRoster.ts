/**
 * 智能体团队的会话数据源（§6.3）：读 agentTeam 投影 + 运行态，合成模型输入 roster。
 * 零 RPC：running 与 roster 都来自框架已有的会话 store（官方 Team UI 同款公式）。
 *
 * 宿主的 ui-session 适配器把 useSessions/useSessionStatus 并进 GlobalStandardProps、
 * useSession/sessionId 并进 SessionStandardProps；这里把快照当不透明值选中后再按
 * 本地视图类型读取，避免与宿主的类型合并发生 TS2717 冲突。
 */
import { useMemo } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { StudioRosterMember } from '../core/pixel/studio-model.ts'
import type { StudioSharedTaskProjection } from '../core/pixel/task-model.ts'

/** agentTeam 投影的最小切片（experimental-agent-team 的 TeamProjection）。 */
export interface StudioTeamMemberProjection {
  readonly id: string
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly phase: 'provisioning' | 'active' | 'failed'
  readonly error?: string
}

export interface StudioTeamProjection {
  readonly members: readonly StudioTeamMemberProjection[]
  /**
   * 团队共享任务板（TeamTaskView）：ownerName 归属、status、ready、writeScopes。
   * 投影缺省时按空任务板处理（老会话 / 投影尚未就绪）。
   */
  readonly tasks?: readonly StudioSharedTaskProjection[]
  readonly failure?: string
}

/** 本地视图类型：只描述本面板读取的字段（对宿主快照做结构性收窄）。 */
export interface StudioSessionsView {
  readonly byId?: Readonly<Record<string, { running?: boolean } | undefined>>
  readonly phase?: string
  readonly projectionsBySession?: Readonly<
    Record<string, { readonly state?: string; readonly values?: { readonly agentTeam?: StudioTeamProjection } }>
  >
}

export interface StudioStatusView {
  get(memberId: string): { running?: boolean } | undefined
}

export interface StudioSessionView {
  readonly subagent?: { readonly address: { readonly parentSessionId?: string } } | null
}

/** slot 标准 props 里被本面板消费的三个 hook（运行时由宿主按 scope 注入）。 */
export interface StudioSessionHooks {
  useSessions: SnapshotSelectorHook<unknown>
  useSessionStatus: SnapshotSelectorHook<unknown>
  useSession: SnapshotSelectorHook<unknown>
}

export type StudioProjectionPhase = 'ready' | 'pending' | 'missing'

export interface StudioRosterState {
  /** lead 会话 id：teammate 会话里上溯父会话（官方同款公式）。 */
  readonly leadId: string
  readonly members: readonly StudioRosterMember[]
  /** lead 会话 agentTeam 投影里的共享任务板；投影未就绪时为空数组。 */
  readonly tasks: readonly StudioSharedTaskProjection[]
  readonly projection: StudioProjectionPhase
  readonly failure?: string
}

/** 投影未就绪时的稳定空任务板（避免每次渲染造新数组击穿下游 memo）。 */
const EMPTY_TASKS: readonly StudioSharedTaskProjection[] = []

/**
 * 合成模型输入 roster：lead 固定 projection 首个 lead；running 取
 * status store，缺失回退 sessions.byId（官方同款 `?? ` 链）。
 * 选择器只回传快照内的稳定引用，避免 selector 每次造新对象触发重渲染。
 */
export function useStudioRoster(
  sessionId: string,
  hooks: StudioSessionHooks,
): StudioRosterState {
  const parentSessionId = hooks.useSession(
    (snapshot) => (snapshot as StudioSessionView | undefined)?.subagent?.address.parentSessionId,
  )
  const leadId = parentSessionId ?? sessionId
  const team = hooks.useSessions(
    (snapshot) =>
      (snapshot as StudioSessionsView | undefined)?.projectionsBySession?.[leadId]?.values
        ?.agentTeam,
  )
  const entryState = hooks.useSessions(
    (snapshot) =>
      (snapshot as StudioSessionsView | undefined)?.projectionsBySession?.[leadId]?.state,
  )
  const listPhase = hooks.useSessions((snapshot) => (snapshot as StudioSessionsView | undefined)?.phase)
  const byId = hooks.useSessions((snapshot) => (snapshot as StudioSessionsView | undefined)?.byId)
  const status = hooks.useSessionStatus((snapshot) => snapshot) as StudioStatusView | undefined
  const members = useMemo(() => {
    if (team === undefined) return []
    return team.members.map((projection) => {
      const running = status?.get(projection.id)?.running ?? byId?.[projection.id]?.running
      return {
        id: projection.id,
        name: projection.name,
        role: projection.role,
        phase: projection.phase,
        running,
        ...(projection.error !== undefined ? { error: projection.error } : {}),
      }
    })
  }, [team, status, byId])
  const projection: StudioProjectionPhase =
    team !== undefined
      ? 'ready'
      : entryState === 'loading' || listPhase === 'pending'
        ? 'pending'
        : 'missing'
  return {
    leadId,
    members,
    tasks: team?.tasks ?? EMPTY_TASKS,
    projection,
    ...(team?.failure !== undefined ? { failure: team.failure } : {}),
  }
}
