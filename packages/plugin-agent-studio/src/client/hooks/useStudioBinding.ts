/**
 * 视角与档案数据（§6.3）：挂载时一次拉 getBinding/listProfiles/listTeams；
 * listRoster 仅作投影未到时的手动兜底（「刷新」按钮触发）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { AgentProfile, SessionBinding, StudioMemberRow, TeamProfile } from '../../types.ts'
import type { AgentStudioRemote } from '../core/remote.ts'
import { errorText, unwrap } from '../core/result.ts'

export interface StudioBindingState {
  readonly binding: SessionBinding | null
  readonly profiles: readonly AgentProfile[]
  readonly teams: readonly TeamProfile[]
  readonly loading: boolean
  readonly error: string
  /** 「刷新」兜底拉到的静态成员行；null = 尚未兜底。 */
  readonly rosterRows: readonly StudioMemberRow[] | null
  readonly rosterLoading: boolean
  refreshRoster(): void
}

const EMPTY_LIST: readonly never[] = []

export function useStudioBinding(studio: AgentStudioRemote, leadId: string): StudioBindingState {
  const [binding, setBinding] = useState<SessionBinding | null>(null)
  const [profiles, setProfiles] = useState<readonly AgentProfile[]>(EMPTY_LIST)
  const [teams, setTeams] = useState<readonly TeamProfile[]>(EMPTY_LIST)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rosterRows, setRosterRows] = useState<readonly StudioMemberRow[] | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)

  useEffect(() => {
    if (leadId === '') return
    let cancelled = false
    setLoading(true)
    Promise.all([studio.getBinding(leadId), studio.listProfiles(), studio.listTeams()])
      .then(([b, p, t]) => {
        if (cancelled) return
        setBinding(unwrap(b))
        setProfiles(unwrap(p))
        setTeams(unwrap(t))
        setError('')
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorText(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId, studio])

  const refreshRoster = useCallback(() => {
    if (leadId === '' || rosterLoading) return
    setRosterLoading(true)
    studio
      .listRoster(leadId)
      .then((rows) => setRosterRows(unwrap(rows)))
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setRosterLoading(false))
  }, [leadId, rosterLoading, studio])

  return {
    binding,
    profiles,
    teams,
    loading,
    error,
    rosterRows,
    rosterLoading,
    refreshRoster,
  }
}
