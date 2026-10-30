import type { AgentStudioRemote } from '../../core/remote.ts'
import { useAgentStudioPanel } from './useAgentStudioPanel.ts'
import styles from './AgentStudioPanel.module.css'

export interface AgentStudioPanelProps {
  sessionId?: string
  studio: AgentStudioRemote
}

export function AgentStudioPanel({ sessionId, studio }: AgentStudioPanelProps): JSX.Element {
  const panel = useAgentStudioPanel(studio, sessionId ?? '')
  const label = panel.binding.mode === 'none'
    ? 'Studio'
    : panel.binding.mode === 'solo'
      ? `Studio · 单人`
      : `Studio · 团队`

  return (
    <div className={styles.root} data-dsh-part="agent-studio-panel">
      <button className={styles.trigger} onClick={panel.toggle} aria-expanded={panel.open}>
        {label}
      </button>
      {panel.open && (
        <div className={styles.panel} role="dialog" aria-label="Agent Studio">
          <header className={styles.panelHead}>
            <strong>Agent Studio</strong>
            <button className={styles.close} onClick={panel.close} aria-label="关闭">×</button>
          </header>

          <label className={styles.field}>会话模式
            <select value={panel.mode} onChange={(event) => panel.setMode(event.target.value === 'solo' || event.target.value === 'team' ? event.target.value : 'none')}>
              <option value="none">不启用</option>
              <option value="solo">单人</option>
              <option value="team">团队</option>
            </select>
          </label>

          {panel.mode === 'solo' && (
            <label className={styles.field}>Agent
              <select value={panel.profileId} onChange={(event) => panel.setProfileId(event.target.value)}>
                <option value="">选择 Agent</option>
                {panel.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}（{profile.model?.model ?? '继承'}）</option>)}
              </select>
            </label>
          )}

          {panel.mode === 'team' && (
            <label className={styles.field}>团队
              <select value={panel.teamId} onChange={(event) => panel.setTeamId(event.target.value)}>
                <option value="">选择团队</option>
                {panel.teams.map((team) => <option key={team.id} value={team.id}>{team.name}（{team.members.length} 人）</option>)}
              </select>
            </label>
          )}

          {panel.capabilities !== null && panel.mode === 'team' && !panel.capabilities.seam && (
            <p className={styles.warn}>当前宿主无法安装成员 preset/model 注入 seam，团队启动已禁用；可先用单人。</p>
          )}

          <button className={styles.secondary} disabled={panel.busy} onClick={panel.saveBinding}>保存选择</button>

          <label className={styles.field}>本次任务
            <textarea rows={3} value={panel.task} onChange={(event) => panel.setTask(event.target.value)} placeholder="团队模式下，成员没填默认任务时用这段" />
          </label>
          <button className={styles.primary} disabled={panel.busy || panel.mode === 'none'} onClick={panel.launch}>启动</button>

          {panel.error !== '' && <p className={styles.error}>{panel.error}</p>}
          {panel.message !== '' && <p className={styles.message}>{panel.message}</p>}

          <div className={styles.roster}>
            <strong>当前 roster</strong>
            {panel.roster.map((member) => (
              <div key={member.id} className={styles.member}>
                <span>{member.role === 'lead' ? '👑 ' : ''}{member.name}</span>
                <span>{member.status}{member.model === undefined ? '' : ` · ${member.model}`}</span>
              </div>
            ))}
            {panel.roster.length === 0 && <span className={styles.muted}>（还没有成员）</span>}
          </div>
        </div>
      )}
    </div>
  )
}
