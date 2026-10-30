import type { AgentStudioRemote } from '../../core/remote.ts'
import { StudioIcon } from '../../components/StudioIcon.tsx'
import { useAgentStudioChip } from './useAgentStudioChip.ts'
import styles from './AgentStudioChip.module.css'

export interface AgentStudioChipProps {
  sessionId?: string
  studio: AgentStudioRemote
}

interface SearchBoxProps {
  value: string
  onChange(value: string): void
}

function SearchBox({ value, onChange }: SearchBoxProps): JSX.Element {
  return (
    <div className={styles.searchRow}>
          <span className={styles.searchIcon}><StudioIcon name="search" size={14} /></span>
      <input
        className={styles.searchInput}
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="搜索智能体或团队"
        aria-label="搜索智能体或团队"
      />
      {value !== '' && (
        <button className={styles.searchClear} onClick={() => onChange('')} aria-label="清空搜索">
          <StudioIcon name="x" size={13} />
        </button>
      )}
    </div>
  )
}

export function AgentStudioChip({ sessionId, studio }: AgentStudioChipProps): JSX.Element {
  const chip = useAgentStudioChip(studio, sessionId ?? '')
  const selectedProfile = chip.binding.mode === 'solo'
    ? chip.profiles.find((profile) => profile.id === chip.binding.profileId)?.id
    : undefined
  const selectedTeam = chip.binding.mode === 'team'
    ? chip.teams.find((team) => team.id === chip.binding.teamId)?.id
    : undefined
  const empty = chip.matchedProfiles.length === 0 && chip.matchedTeams.length === 0

  return (
    <div className={styles.root} data-dsh-part="agent-studio-chip">
      <button ref={chip.triggerRef} className={styles.trigger} onClick={chip.toggle} aria-expanded={chip.open} title="选择当前会话使用的智能体 / 团队">
        <StudioIcon name={chip.binding.mode === 'team' ? 'blocks' : 'box'} size={15} />
        <span className={styles.label}>{chip.label}</span>
        <span className={styles.chevron}><StudioIcon name="chevron-down" size={12} /></span>
      </button>

      {chip.open && (
        <>
          <button className={styles.backdrop} onClick={chip.close} aria-label="关闭" />
          <div
            className={styles.menu}
            role="menu"
            style={chip.anchor === null ? undefined : { left: chip.anchor.left, bottom: chip.anchor.bottom }}
          >
            <SearchBox value={chip.query} onChange={chip.setQuery} />

            {chip.query.trim() === '' && (
              <button className={styles.option} onClick={chip.selectNone}>
                <span className={styles.optionIcon}><StudioIcon name="box" size={15} /></span>
                <span className={styles.optionCopy}>
                  <span className={styles.optionName}>默认</span>
                  <span className={styles.optionMeta}>不启用智能体工坊</span>
                </span>
                {chip.binding.mode === 'none' && <span className={styles.check}><StudioIcon name="check" size={14} /></span>}
              </button>
            )}

            {chip.visibleProfiles.length > 0 && (
              <p className={styles.group}>
                智能体
                {chip.matchedProfiles.length > chip.visibleProfiles.length && <span className={styles.groupCount}>{chip.matchedProfiles.length}</span>}
              </p>
            )}
            {chip.visibleProfiles.map((profile) => (
              <button key={profile.id} className={styles.option} onClick={() => chip.selectProfile(profile)}>
                <span className={styles.optionIcon}><StudioIcon name="box" size={15} /></span>
                <span className={styles.optionCopy}>
                  <span className={styles.optionName}>{profile.displayName}</span>
                  <span className={styles.optionMeta}>{profile.model?.model ?? '继承模型'}</span>
                </span>
                {selectedProfile === profile.id && <span className={styles.check}><StudioIcon name="check" size={14} /></span>}
              </button>
            ))}
            {chip.hasMoreProfiles && (
              <button className={styles.more} onClick={chip.openPicker}>
                查看更多智能体（{chip.matchedProfiles.length}）
              </button>
            )}

            {chip.visibleTeams.length > 0 && (
              <p className={styles.group}>
                团队
                {chip.matchedTeams.length > chip.visibleTeams.length && <span className={styles.groupCount}>{chip.matchedTeams.length}</span>}
              </p>
            )}
            {chip.visibleTeams.map((team) => (
              <button key={team.id} className={styles.option} onClick={() => chip.selectTeam(team)}>
                <span className={styles.optionIcon}><StudioIcon name="blocks" size={15} /></span>
                <span className={styles.optionCopy}>
                  <span className={styles.optionName}>{team.name}</span>
                  <span className={styles.optionMeta}>{team.members.map((member) => member.name).join(' · ')}</span>
                </span>
                {selectedTeam === team.id && <span className={styles.check}><StudioIcon name="check" size={14} /></span>}
              </button>
            ))}
            {chip.hasMoreTeams && (
              <button className={styles.more} onClick={chip.openPicker}>
                查看更多团队（{chip.matchedTeams.length}）
              </button>
            )}

            {empty && <p className={styles.status}>没有匹配的智能体或团队</p>}
            {chip.busy && <p className={styles.status}>保存中…</p>}
            {chip.error !== '' && <p className={styles.error}>{chip.error}</p>}
            {chip.query.trim() === '' && (
              <p className={styles.hint}>选中后，模型会根据对话自己决定何时调用智能体 / 创建团队；不需要你填任务。</p>
            )}
          </div>
        </>
      )}

      {chip.pickerOpen && (
        <>
          <button className={styles.backdrop} onClick={chip.closePicker} aria-label="关闭" />
          <div className={styles.pickerOverlay} onMouseDown={(event) => { if (event.target === event.currentTarget) chip.closePicker() }}>
            <div className={styles.pickerDialog} role="dialog" aria-modal="true" aria-label="选择智能体或团队">
              <header className={styles.pickerHead}>
                <h3>选择智能体或团队</h3>
                <button className={styles.closeButton} onClick={chip.closePicker} aria-label="关闭">
                  <StudioIcon name="x" size={16} />
                </button>
              </header>
              <div className={styles.pickerSearch}><SearchBox value={chip.query} onChange={chip.setQuery} /></div>
              <div className={styles.pickerBody}>
                {chip.matchedProfiles.length > 0 && (
                  <>
                    <p className={styles.group}>智能体</p>
                    <div className={styles.pickerList}>
                      {chip.matchedProfiles.map((profile) => (
                        <button key={profile.id} className={styles.option} onClick={() => chip.selectProfile(profile)}>
                          <span className={styles.optionIcon}><StudioIcon name="box" size={15} /></span>
                          <span className={styles.optionCopy}>
                            <span className={styles.optionName}>{profile.displayName}</span>
                            <span className={styles.optionMeta}>{profile.description || profile.name}</span>
                          </span>
                          {selectedProfile === profile.id && <span className={styles.check}><StudioIcon name="check" size={14} /></span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {chip.matchedTeams.length > 0 && (
                  <>
                    <p className={styles.group}>团队</p>
                    <div className={styles.pickerList}>
                      {chip.matchedTeams.map((team) => (
                        <button key={team.id} className={styles.option} onClick={() => chip.selectTeam(team)}>
                          <span className={styles.optionIcon}><StudioIcon name="blocks" size={15} /></span>
                          <span className={styles.optionCopy}>
                            <span className={styles.optionName}>{team.name}</span>
                            <span className={styles.optionMeta}>{team.description || team.members.map((member) => member.name).join(' · ')}</span>
                          </span>
                          {selectedTeam === team.id && <span className={styles.check}><StudioIcon name="check" size={14} /></span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {empty && <p className={styles.status}>没有匹配的智能体或团队</p>}
                {chip.busy && <p className={styles.status}>保存中…</p>}
                {chip.error !== '' && <p className={styles.error}>{chip.error}</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
