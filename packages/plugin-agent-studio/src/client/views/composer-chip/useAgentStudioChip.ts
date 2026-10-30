import { useCallback, useEffect, useState } from 'react'
import type { AgentProfile, SessionBinding, TeamProfile } from '../../../types.ts'
import type { AgentStudioRemote } from '../../core/remote.ts'
import { errorText, unwrap } from '../../core/result.ts'

export interface AgentStudioChipState {
  open: boolean
  toggle(): void
  close(): void
  profiles: AgentProfile[]
  teams: TeamProfile[]
  binding: SessionBinding
  label: string
  busy: boolean
  error: string
  selectNone(): void
  selectProfile(profile: AgentProfile): void
  selectTeam(team: TeamProfile): void
}

const NONE: SessionBinding = { sessionId: '', mode: 'none', updatedAt: 0 }

export function useAgentStudioChip(studio: AgentStudioRemote, sessionId: string): AgentStudioChipState {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [teams, setTeams] = useState<TeamProfile[]>([])
  const [binding, setBinding] = useState<SessionBinding>(NONE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (sessionId === '') return
    const [p, t, b] = await Promise.all([
      studio.listProfiles(),
      studio.listTeams(),
      studio.getBinding(sessionId),
    ])
    setProfiles(unwrap(p))
    setTeams(unwrap(t))
    setBinding(unwrap(b))
  }, [sessionId, studio])

  useEffect(() => {
    void load().catch((cause: unknown) => setError(errorText(cause)))
  }, [load])

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => {
    setError('')
    setOpen((value) => !value)
  }, [])

  const save = useCallback(async (input: { mode: SessionBinding['mode']; profileId?: string; teamId?: string }) => {
    if (sessionId === '') {
      setError('找不到当前会话 id')
      return
    }
    setBusy(true)
    setError('')
    try {
      const next = unwrap(await studio.setBinding({ sessionId, ...input }))
      setBinding(next)
      setOpen(false)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }, [sessionId, studio])

  const label = binding.mode === 'solo'
    ? profiles.find((profile) => profile.id === binding.profileId)?.displayName ?? '单人 Agent'
    : binding.mode === 'team'
      ? teams.find((team) => team.id === binding.teamId)?.name ?? '团队'
      : 'Agent'

  return {
    open, toggle, close,
    profiles, teams, binding, label, busy, error,
    selectNone: () => void save({ mode: 'none' }),
    selectProfile: (profile) => void save({ mode: 'solo', profileId: profile.id }),
    selectTeam: (team) => void save({ mode: 'team', teamId: team.id }),
  }
}
