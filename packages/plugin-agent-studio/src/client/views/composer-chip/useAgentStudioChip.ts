import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AgentProfile, SessionBinding, TeamProfile } from '../../../types.ts'
import type { AgentStudioRemote } from '../../core/remote.ts'
import { errorText, unwrap } from '../../core/result.ts'

export interface AgentStudioChipState {
  open: boolean
  triggerRef: RefObject<HTMLButtonElement>
  anchor: { left: number; bottom: number } | null
  toggle(): void
  close(): void
  query: string
  setQuery(value: string): void
  profiles: AgentProfile[]
  teams: TeamProfile[]
  visibleProfiles: AgentProfile[]
  visibleTeams: TeamProfile[]
  matchedProfiles: AgentProfile[]
  matchedTeams: TeamProfile[]
  hasMoreProfiles: boolean
  hasMoreTeams: boolean
  pickerOpen: boolean
  openPicker(): void
  closePicker(): void
  binding: SessionBinding
  label: string
  busy: boolean
  error: string
  selectNone(): void
  selectProfile(profile: AgentProfile): void
  selectTeam(team: TeamProfile): void
}

const NONE: SessionBinding = { sessionId: '', mode: 'none', updatedAt: 0 }
const MAX_VISIBLE = 5

function matches(query: string, values: readonly (string | undefined)[]): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return values.some((value) => value !== undefined && value.toLowerCase().includes(needle))
}

export function useAgentStudioChip(studio: AgentStudioRemote, sessionId: string): AgentStudioChipState {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
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

  const matchedProfiles = useMemo(
    () => profiles.filter((profile) => matches(query, [profile.name, profile.displayName, profile.description])),
    [profiles, query],
  )
  const matchedTeams = useMemo(
    () => teams.filter((team) => matches(query, [
      team.name,
      team.description,
      ...team.members.map((member) => profiles.find((profile) => profile.id === member.profileId)?.name),
    ])),
    [profiles, teams, query],
  )

  useEffect(() => {
    if (!open && !pickerOpen) return
    const onResize = (): void => { setOpen(false); setPickerOpen(false) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, pickerOpen])

  useEffect(() => {
    if (!open && !pickerOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      setPickerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pickerOpen])

  const close = useCallback(() => setOpen(false), [])
  const closePicker = useCallback(() => setPickerOpen(false), [])
  const openPicker = useCallback(() => {
    setOpen(false)
    setPickerOpen(true)
  }, [])
  const toggle = useCallback(() => {
    setError('')
    setOpen((value) => {
      if (value) return false
      const element = triggerRef.current
      if (element !== null) {
        const rect = element.getBoundingClientRect()
        setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 6 })
      }
      return true
    })
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
      setPickerOpen(false)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }, [sessionId, studio])

  const label = binding.mode === 'solo'
    ? profiles.find((profile) => profile.id === binding.profileId)?.displayName ?? '单人'
    : binding.mode === 'team'
      ? teams.find((team) => team.id === binding.teamId)?.name ?? '团队'
      : '智能体'

  return {
    open, triggerRef, anchor, toggle, close,
    query, setQuery,
    profiles, teams,
    visibleProfiles: matchedProfiles.slice(0, MAX_VISIBLE),
    visibleTeams: matchedTeams.slice(0, MAX_VISIBLE),
    matchedProfiles,
    matchedTeams,
    hasMoreProfiles: matchedProfiles.length > MAX_VISIBLE,
    hasMoreTeams: matchedTeams.length > MAX_VISIBLE,
    pickerOpen, openPicker, closePicker,
    binding, label, busy, error,
    selectNone: () => void save({ mode: 'none' }),
    selectProfile: (profile) => void save({ mode: 'solo', profileId: profile.id }),
    selectTeam: (team) => void save({ mode: 'team', teamId: team.id }),
  }
}
