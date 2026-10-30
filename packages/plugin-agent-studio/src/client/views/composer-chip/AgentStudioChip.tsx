import type { AgentStudioRemote } from '../../core/remote.ts'
import { useAgentStudioChip } from './useAgentStudioChip.ts'
import styles from './AgentStudioChip.module.css'

export interface AgentStudioChipProps {
  sessionId?: string
  studio: AgentStudioRemote
}

export function AgentStudioChip({ sessionId, studio }: AgentStudioChipProps): JSX.Element {
  const chip = useAgentStudioChip(studio, sessionId ?? '')
  const selectedProfile = chip.binding.mode === 'solo'
    ? chip.profiles.find((profile) => profile.id === chip.binding.profileId)?.id
    : undefined
  const selectedTeam = chip.binding.mode === 'team'
    ? chip.teams.find((team) => team.id === chip.binding.teamId)?.id
    : undefined

  return (
    <div className={styles.root} data-dsh-part="agent-studio-chip">
      <button ref={chip.triggerRef} className={styles.trigger} onClick={chip.toggle} aria-expanded={chip.open} title="选择当前会话使用的 Agent / 团队">
        <span className={styles.label}>{chip.label}</span>
        <span className={styles.chevron}>▾</span>
      </button>

      {chip.open && (
        <>
          <button className={styles.backdrop} onClick={chip.close} aria-label="关闭" />
          <div
            className={styles.menu}
            role="menu"
            style={chip.anchor === null ? undefined : { left: chip.anchor.left, bottom: chip.anchor.bottom }}
          >
            <button className={styles.option} onClick={chip.selectNone}>
              <span className={styles.optionCopy}>
                <span className={styles.optionName}>默认</span>
                <span className={styles.optionMeta}>不启用 Agent Studio</span>
              </span>
              {chip.binding.mode === 'none' && <span className={styles.check}>✓</span>}
            </button>

            {chip.profiles.length > 0 && <p className={styles.group}>单人 Agent</p>}
            {chip.profiles.map((profile) => (
              <button key={profile.id} className={styles.option} onClick={() => chip.selectProfile(profile)}>
                <span className={styles.optionCopy}>
                  <span className={styles.optionName}>{profile.displayName}</span>
                  <span className={styles.optionMeta}>{profile.model?.model ?? '继承模型'}</span>
                </span>
                {selectedProfile === profile.id && <span className={styles.check}>✓</span>}
              </button>
            ))}

            {chip.teams.length > 0 && <p className={styles.group}>团队</p>}
            {chip.teams.map((team) => (
              <button key={team.id} className={styles.option} onClick={() => chip.selectTeam(team)}>
                <span className={styles.optionCopy}>
                  <span className={styles.optionName}>{team.name}</span>
                  <span className={styles.optionMeta}>{team.members.map((member) => member.name).join(' · ')}</span>
                </span>
                {selectedTeam === team.id && <span className={styles.check}>✓</span>}
              </button>
            ))}

            {chip.busy && <p className={styles.status}>保存中…</p>}
            {chip.error !== '' && <p className={styles.error}>{chip.error}</p>}
            <p className={styles.hint}>选中后，模型会根据对话自己决定何时调用 Agent / 创建团队；不需要你填任务。</p>
          </div>
        </>
      )}
    </div>
  )
}
