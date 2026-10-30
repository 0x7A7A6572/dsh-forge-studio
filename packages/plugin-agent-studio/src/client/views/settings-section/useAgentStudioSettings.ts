import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentProfile, AgentStudioModelGroup, AgentStudioPresetRow, TeamProfile } from '../../../types.ts'
import type { AgentStudioRemote } from '../../core/remote.ts'
import { errorText, unwrap } from '../../core/result.ts'

export type StudioTab = 'profiles' | 'teams'

export function emptyProfile(): AgentProfile {
  return {
    id: '',
    name: 'new-agent',
    displayName: '新 Agent',
    description: '',
    rolePrompt: '',
    defaultTask: '',
    model: null,
    context: 'fresh',
    maxDepth: 1,
    avatarSeed: 'default',
    createdAt: 0,
    updatedAt: 0,
  }
}

export function emptyTeam(): TeamProfile {
  return {
    id: '',
    name: '新团队',
    description: '',
    members: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

export function useAgentStudioSettings(studio: AgentStudioRemote) {
  const [tab, setTab] = useState<StudioTab>('profiles')
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [teams, setTeams] = useState<TeamProfile[]>([])
  const [models, setModels] = useState<AgentStudioModelGroup[]>([])
  const [presets, setPresets] = useState<AgentStudioPresetRow[]>([])
  const [profileDraft, setProfileDraft] = useState<AgentProfile | null>(null)
  const [teamDraft, setTeamDraft] = useState<TeamProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState('')
  const reloadInFlight = useRef(false)
  const fetchSeq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++fetchSeq.current
    const [p, t, m, pr] = await Promise.all([
      studio.listProfiles(),
      studio.listTeams(),
      studio.listModels(),
      studio.listPresets(),
    ])
    if (mine !== fetchSeq.current) return
    const next = [unwrap(p), unwrap(t), unwrap(m), unwrap(pr)] as const
    setProfiles(next[0])
    setTeams(next[1])
    setModels(next[2])
    setPresets(next[3])
  }, [studio])

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(errorText(cause)))
  }, [refresh])

  const reload = useCallback(async () => {
    if (reloadInFlight.current) return
    reloadInFlight.current = true
    setReloading(true)
    setError('')
    try {
      await refresh()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      reloadInFlight.current = false
      setReloading(false)
    }
  }, [refresh])

  useEffect(() => {
    if (profileDraft === null && teamDraft === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setProfileDraft(null)
      setTeamDraft(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [profileDraft, teamDraft])

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const saveProfile = useCallback(() => {
    if (profileDraft === null) return
    void run(async () => {
      unwrap(await studio.saveProfile({ profile: profileDraft }))
      setProfileDraft(null)
    })
  }, [profileDraft, run, studio])

  const removeProfile = useCallback((id: string) => {
    void run(async () => { unwrap(await studio.deleteProfile(id)) })
  }, [run, studio])

  const saveTeam = useCallback(() => {
    if (teamDraft === null) return
    void run(async () => {
      unwrap(await studio.saveTeam({ team: teamDraft }))
      setTeamDraft(null)
    })
  }, [run, studio, teamDraft])

  const removeTeam = useCallback((id: string) => {
    void run(async () => { unwrap(await studio.deleteTeam(id)) })
  }, [run, studio])

  const addMember = useCallback((profile: AgentProfile) => {
    setTeamDraft((draft) => {
      if (draft === null) return draft
      const names = new Set(draft.members.map((member) => member.name))
      let name = profile.name
      let index = 2
      while (names.has(name)) {
        name = `${profile.name}-${index}`
        index += 1
      }
      return { ...draft, members: [...draft.members, { ...profile, id: crypto.randomUUID(), name }] }
    })
  }, [])

  const removeMember = useCallback((id: string) => {
    setTeamDraft((draft) => draft === null ? draft : { ...draft, members: draft.members.filter((member) => member.id !== id) })
  }, [])

  return {
    tab, setTab,
    profiles, teams, models, presets, busy, reloading, error,
    profileDraft, setProfileDraft,
    teamDraft, setTeamDraft,
    reload, saveProfile, removeProfile, saveTeam, removeTeam, addMember, removeMember,
    newProfile: () => setProfileDraft(emptyProfile()),
    newTeam: () => setTeamDraft(emptyTeam()),
    closeEditors: () => { setProfileDraft(null); setTeamDraft(null) },
  }
}
