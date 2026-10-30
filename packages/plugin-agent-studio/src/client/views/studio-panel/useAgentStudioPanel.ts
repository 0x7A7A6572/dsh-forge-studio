import { useCallback, useEffect, useState } from 'react'
import type { AgentProfile, SessionBinding, StudioCapabilities, StudioMemberRow, TeamProfile } from '../../../types.ts'
import type { AgentStudioRemote } from '../../core/remote.ts'
import { errorText, unwrap } from '../../core/result.ts'

export interface AgentStudioPanelState {
  open: boolean
  toggle(): void
  close(): void
  profiles: AgentProfile[]
  teams: TeamProfile[]
  binding: SessionBinding
  capabilities: StudioCapabilities | null
  roster: StudioMemberRow[]
  mode: SessionBinding['mode']
  setMode(mode: SessionBinding['mode']): void
  profileId: string
  setProfileId(id: string): void
  teamId: string
  setTeamId(id: string): void
  task: string
  setTask(task: string): void
  busy: boolean
  message: string
  error: string
  saveBinding(): void
  launch(): void
}

const NONE: SessionBinding = { sessionId: '', mode: 'none', updatedAt: 0 }

export function useAgentStudioPanel(studio: AgentStudioRemote, sessionId: string): AgentStudioPanelState {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [teams, setTeams] = useState<TeamProfile[]>([])
  const [binding, setBinding] = useState<SessionBinding>(NONE)
  const [capabilities, setCapabilities] = useState<StudioCapabilities | null>(null)
  const [roster, setRoster] = useState<StudioMemberRow[]>([])
  const [mode, setMode] = useState<SessionBinding['mode']>('none')
  const [profileId, setProfileId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (sessionId === '') return
    const [p, t, b, c, r] = await Promise.all([
      studio.listProfiles(),
      studio.listTeams(),
      studio.getBinding(sessionId),
      studio.getCapabilities(),
      studio.listRoster(sessionId),
    ])
    const nextProfiles = unwrap(p)
    const nextTeams = unwrap(t)
    const nextBinding = unwrap(b)
    setProfiles(nextProfiles)
    setTeams(nextTeams)
    setBinding(nextBinding)
    setCapabilities(unwrap(c))
    setRoster(unwrap(r))
    setMode(nextBinding.mode)
    setProfileId(nextBinding.profileId ?? nextProfiles[0]?.id ?? '')
    setTeamId(nextBinding.teamId ?? nextTeams[0]?.id ?? '')
  }, [studio, sessionId])

  useEffect(() => {
    if (!open) return
    void load().catch((cause: unknown) => setError(errorText(cause)))
  }, [load, open])

  const toggle = useCallback(() => {
    setOpen((value) => !value)
    setError('')
    setMessage('')
  }, [])
  const close = useCallback(() => setOpen(false), [])

  const saveBinding = useCallback(() => {
    if (sessionId === '') {
      setError('找不到当前会话 id')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    void (async () => {
      try {
        const next = unwrap(await studio.setBinding({
          sessionId,
          mode,
          ...(mode === 'solo' ? { profileId: profileId === '' ? undefined : profileId } : {}),
          ...(mode === 'team' ? { teamId: teamId === '' ? undefined : teamId } : {}),
        }))
        setBinding(next)
        setMessage('已保存会话选择')
      } catch (cause) {
        setError(errorText(cause))
      } finally {
        setBusy(false)
      }
    })()
  }, [mode, profileId, sessionId, studio, teamId])

  const launch = useCallback(() => {
    if (sessionId === '') {
      setError('找不到当前会话 id')
      return
    }
    if (task.trim() === '') {
      setError('请先填写本次任务')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    void (async () => {
      try {
        if (mode !== 'none') {
          const next = unwrap(await studio.setBinding({
            sessionId,
            mode,
            ...(mode === 'solo' ? { profileId: profileId === '' ? undefined : profileId } : {}),
            ...(mode === 'team' ? { teamId: teamId === '' ? undefined : teamId } : {}),
          }))
          setBinding(next)
        }
        const result = unwrap(await studio.launch({
          sessionId,
          task,
          ...(mode === 'solo' && profileId !== '' ? { profileId } : {}),
          ...(mode === 'team' && teamId !== '' ? { teamId } : {}),
        }))
        if ('childId' in result) setMessage(`已启动单人：${profileId} · ${result.childId}`)
        else setMessage(`已启动团队：成功 ${result.members.length}，失败 ${result.failed.length}${result.failed.length > 0 ? '（' + result.failed.map((item) => item.name).join(', ') + '）' : ''}`)
        setRoster(unwrap(await studio.listRoster(sessionId)))
      } catch (cause) {
        setError(errorText(cause))
      } finally {
        setBusy(false)
      }
    })()
  }, [mode, profileId, sessionId, studio, task, teamId])

  return {
    open, toggle, close,
    profiles, teams, binding, capabilities, roster,
    mode, setMode, profileId, setProfileId, teamId, setTeamId,
    task, setTask, busy, message, error,
    saveBinding, launch,
  }
}
