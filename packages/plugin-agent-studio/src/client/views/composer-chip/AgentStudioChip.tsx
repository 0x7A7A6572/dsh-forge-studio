import type { AgentStudioRemote } from '../../core/remote.ts'
import { useAgentStudioChip } from './useAgentStudioChip.ts'
import styles from './AgentStudioChip.module.css'

export interface AgentStudioChipProps {
  sessionId?: string
  studio: AgentStudioRemote
}

export function AgentStudioChip({ sessionId, studio }: AgentStudioChipProps): JSX.Element {
  const chip = useAgentStudioChip(studio, sessionId ?? '')
  return (
    <div className={styles.root} data-dsh-part="agent-studio-chip">
      <button className={styles.chip} onClick={chip.toggle} aria-expanded={chip.open} title="选择当前会话使用的 Agent / 团队">
        <span className={styles.dot}>◆</span>
        {chip.label}
      </button>

      {chip.open && (
        <>
          <button className={styles.backdrop} onClick={chip.close} aria-label="关闭" />
          <div className={styles.menu} role="menu">
            <button className={styles.item} onClick={chip.selectNone}>
              <span>默认</span>
              <small>不启用 Agent Studio</small>
            </button>

            {chip.profiles.length > 0 && <p className={styles.group}>单人 Agent</p>}
            {chip.profiles.map((profile) => (
              <button
                key={profile.id}
                className={chip.binding.mode === 'solo' && chip.binding.profileId === profile.id ? styles.itemActive : styles.item}
                onClick={() => chip.selectProfile(profile)}
              >
                <span>{profile.displayName}</span>
                <small>{profile.model?.model ?? '继承模型'}</small>
              </button>
            ))}

            {chip.teams.length > 0 && <p className={styles.group}>团队</p>}
            {chip.teams.map((team) => (
              <button
                key={team.id}
                className={chip.binding.mode === 'team' && chip.binding.teamId === team.id ? styles.itemActive : styles.item}
                onClick={() => chip.selectTeam(team)}
              >
                <span>{team.name}</span>
                <small>{team.members.map((member) => member.name).join(' · ')}</small>
              </button>
            ))}

            {chip.busy && <p className={styles.note}>保存中…</p>}
            {chip.error !== '' && <p className={styles.error}>{chip.error}</p>}
            <p className={styles.hint}>选中后，模型会根据对话自己决定何时调用 Agent / 创建团队；不需要你填任务。</p>
          </div>
        </>
      )}
    </div>
  )
}
