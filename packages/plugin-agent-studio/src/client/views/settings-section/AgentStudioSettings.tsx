import type { AgentProfile, TeamProfile } from '../../../types.ts'
import type { AgentStudioRemote } from '../../core/remote.ts'
import { StudioIcon } from '../../components/StudioIcon.tsx'
import { PixelAvatar } from '../../components/PixelAvatar.tsx'
import { BOT_SCHEME_HEX, BOT_TEAM_FRAME } from '../../core/pixel/bot-avatar.ts'
import { StagePrefSwitch } from './StagePrefSwitch.tsx'
import { useAgentStudioSettings } from './useAgentStudioSettings.ts'
import styles from './AgentStudioSettings.module.css'

export interface AgentStudioSettingsProps {
  studio: AgentStudioRemote
}

export function AgentStudioSettings({ studio }: AgentStudioSettingsProps): JSX.Element {
  const s = useAgentStudioSettings(studio)
  const modelGroup = s.profileDraft?.model === null || s.profileDraft?.model === undefined
    ? undefined
    : s.models.find((group) => group.provider === s.profileDraft?.model?.provider)
  const profileById = (profileId: string): AgentProfile | undefined =>
    s.profiles.find((profile) => profile.id === profileId)
  const teamMemberNames = (team: TeamProfile): string =>
    team.members.map((member) => profileById(member.profileId)?.name ?? '已删除').join(' · ')

  const updateProfile = (patch: Partial<AgentProfile>): void => {
    if (s.profileDraft === null) return
    s.setProfileDraft({ ...s.profileDraft, ...patch })
  }

  const updateTeam = (patch: Partial<TeamProfile>): void => {
    if (s.teamDraft === null) return
    s.setTeamDraft({ ...s.teamDraft, ...patch })
  }

  return (
    <section className={styles.root} data-dsh-part="agent-studio-settings">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>智能体工坊</h2>
          <p className={styles.hint}>定义可复用的智能体与团队。会话里选中后，模型会自己判断何时派活。</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="刷新"
            title="刷新（重新读取智能体 / 团队 / 模型 / preset）"
            data-dsh-action="reload"
            disabled={s.busy}
            aria-disabled={s.reloading || undefined}
            aria-busy={s.reloading}
            onClick={() => { void s.reload() }}
          >
            <StudioIcon name="refresh" size={15} className={s.reloading ? styles.spin : undefined} />
          </button>
          <span className={styles.srOnly} role="status">{s.reloading ? '正在刷新' : ''}</span>
          <button className={styles.primary} onClick={s.newProfile}>
            <StudioIcon name="plus" size={14} />
            新建智能体
          </button>
        </div>
      </header>

      {s.error !== '' && <p className={styles.error} role="alert">{s.error}</p>}

      <section className={styles.section}>
        <div className={styles.stagePref}>
          <div className={styles.stagePrefCopy}>
            <h3 className={styles.sectionTitle}>工作预览</h3>
            <p className={styles.stagePrefDesc}>会话头入口与像素办公室实况（团队成员、任务活动）。</p>
          </div>
          <StagePrefSwitch />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>智能体</h3>
          <span className={styles.count}>{s.profiles.length}</span>
        </div>
        {s.error === '' && s.profiles.length === 0 && <p className={styles.empty}>还没有智能体。点右上角新建。</p>}
        {s.profiles.map((profile) => (
          <article key={profile.id} className={styles.row}>
            <span className={styles.rowIcon}><PixelAvatar id={profile.id} size={32} color={profile.avatarColor} /></span>
            <span className={styles.rowBody}>
              <span className={styles.rowTitle}>
                <strong>{profile.displayName}</strong>
                <code>{profile.name}</code>
              </span>
              <span className={styles.rowDescription}>{profile.description || '（无描述）'}</span>
              <span className={styles.rowMeta}>{profile.model?.model ?? '继承模型'} · {profile.presetId ?? '继承 preset'}</span>
            </span>
            <span className={styles.rowActions}>
              <button
                className={styles.iconButton}
                onClick={() => { void studio.openConfigFolder({ kind: 'agent', id: profile.id }).catch(() => {}) }}
                aria-label="打开配置文件"
                title="在资源管理器中打开配置文件"
              >
                <StudioIcon name="folder" size={15} />
              </button>
              <button className={styles.iconButton} onClick={() => s.setProfileDraft(profile)} aria-label="编辑" title="编辑">
                <StudioIcon name="pencil" size={15} />
              </button>
              <button className={styles.iconButtonDanger} onClick={() => s.removeProfile(profile.id)} aria-label="删除" title="删除">
                <StudioIcon name="trash" size={15} />
              </button>
            </span>
          </article>
        ))}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>团队</h3>
          <span className={styles.count}>{s.teams.length}</span>
          <button className={styles.secondary} onClick={s.newTeam}>
            <StudioIcon name="plus" size={14} />
            新建团队
          </button>
        </div>
        {s.error === '' && s.teams.length === 0 && <p className={styles.empty}>还没有团队。把智能体组合起来即可。</p>}
        {s.teams.map((team) => (
          <article key={team.id} className={styles.row}>
            <span className={styles.rowIcon}><PixelAvatar id={team.id} size={18} overrideFrame={BOT_TEAM_FRAME} /></span>
            <span className={styles.rowBody}>
              <span className={styles.rowTitle}>
                <strong>{team.name}</strong>
                <code>{team.members.length} 人</code>
              </span>
              <span className={styles.rowDescription}>{team.description || '（无描述）'}</span>
              <span className={styles.rowMeta}>{teamMemberNames(team)}</span>
            </span>
            <span className={styles.rowActions}>
              <button
                className={styles.iconButton}
                onClick={() => { void studio.openConfigFolder({ kind: 'team', id: team.id }).catch(() => {}) }}
                aria-label="打开配置文件"
                title="在资源管理器中打开配置文件"
              >
                <StudioIcon name="folder" size={15} />
              </button>
              <button className={styles.iconButton} onClick={() => s.setTeamDraft(team)} aria-label="编辑" title="编辑">
                <StudioIcon name="pencil" size={15} />
              </button>
              <button className={styles.iconButtonDanger} onClick={() => s.removeTeam(team.id)} aria-label="删除" title="删除">
                <StudioIcon name="trash" size={15} />
              </button>
            </span>
          </article>
        ))}
      </section>

      {s.profileDraft !== null && (
        <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) s.setProfileDraft(null) }}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="编辑智能体">
            <header className={styles.dialogHead}>
              <h3>{s.profileDraft.id === '' ? '新建智能体' : '编辑智能体'}</h3>
              <button className={styles.iconButton} onClick={() => s.setProfileDraft(null)} aria-label="关闭">
                <StudioIcon name="x" size={16} />
              </button>
            </header>
            <div className={styles.dialogBody}>
              {s.error !== '' && <p className={styles.error} role="alert">{s.error}</p>}
              <div className={styles.row2}>
                <label className={styles.field}>名字
                  <input autoFocus value={s.profileDraft.name} onChange={(event) => updateProfile({ name: event.target.value })} />
                </label>
                <label className={styles.field}>显示名
                  <input value={s.profileDraft.displayName} onChange={(event) => updateProfile({ displayName: event.target.value })} />
                </label>
              </div>
              <label className={styles.field}>职责
                <input value={s.profileDraft.description} onChange={(event) => updateProfile({ description: event.target.value })} />
              </label>
              <label className={styles.field}>角色提示词
                <textarea rows={5} value={s.profileDraft.rolePrompt} onChange={(event) => updateProfile({ rolePrompt: event.target.value })} />
              </label>
              <label className={styles.field}>Preset
                <select value={s.profileDraft.presetId ?? ''} onChange={(event) => updateProfile({ presetId: event.target.value === '' ? undefined : event.target.value })}>
                  <option value="">继承 Lead / 部署默认</option>
                  {s.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              </label>
              <div className={styles.row2}>
                <label className={styles.field}>Provider
                  <select
                    value={s.profileDraft.model?.provider ?? ''}
                    onChange={(event) => {
                      const provider = event.target.value
                      updateProfile({ model: provider === '' ? null : { provider, model: '' } })
                    }}
                  >
                    <option value="">继承 Lead</option>
                    {s.models.map((group) => <option key={group.provider} value={group.provider}>{group.provider}</option>)}
                  </select>
                </label>
                <label className={styles.field}>Model
                  <select
                    value={s.profileDraft.model?.model ?? ''}
                    disabled={modelGroup === undefined}
                    onChange={(event) => {
                      if (s.profileDraft?.model === null || s.profileDraft?.model === undefined) return
                      updateProfile({ model: { ...s.profileDraft.model, model: event.target.value } })
                    }}
                  >
                    <option value="">选择模型</option>
                    {(modelGroup?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </select>
                </label>
              </div>
              <div className={styles.row2}>
                <label className={styles.field}>Context
                  <select value={s.profileDraft.context} onChange={(event) => updateProfile({ context: event.target.value === 'fork' ? 'fork' : 'fresh' })}>
                    <option value="fresh">fresh（不带历史）</option>
                    <option value="fork">fork（继承已完成轮次）</option>
                  </select>
                </label>
                <label className={styles.field}>委派深度
                  <input type="number" min={0} max={8} value={s.profileDraft.maxDepth} onChange={(event) => updateProfile({ maxDepth: Number(event.target.value) })} />
                </label>
              </div>
              <div className={styles.field}>
                头像配色
                <div className={styles.swatchRow}>
                  <PixelAvatar
                    id={s.profileDraft.id === '' ? s.profileDraft.name : s.profileDraft.id}
                    size={28}
                    color={s.profileDraft.avatarColor}
                  />
                  {BOT_SCHEME_HEX.map((hex, scheme) => (
                    <button
                      key={hex}
                      type="button"
                      className={`${styles.swatch} ${s.profileDraft?.avatarColor === scheme ? styles.swatchActive : ''}`}
                      style={{ background: hex }}
                      onClick={() => updateProfile({ avatarColor: scheme })}
                      aria-label={`配色 ${scheme + 1}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <footer className={styles.dialogFoot}>
              <button className={styles.secondary} onClick={() => s.setProfileDraft(null)}>取消</button>
              <button className={styles.primary} disabled={s.busy} onClick={s.saveProfile}>保存</button>
            </footer>
          </div>
        </div>
      )}

      {s.teamDraft !== null && (
        <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) s.setTeamDraft(null) }}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="编辑团队">
            <header className={styles.dialogHead}>
              <h3>{s.teamDraft.id === '' ? '新建团队' : '编辑团队'}</h3>
              <button className={styles.iconButton} onClick={() => s.setTeamDraft(null)} aria-label="关闭">
                <StudioIcon name="x" size={16} />
              </button>
            </header>
            <div className={styles.dialogBody}>
              {s.error !== '' && <p className={styles.error} role="alert">{s.error}</p>}
              <label className={styles.field}>团队名
                <input autoFocus value={s.teamDraft.name} onChange={(event) => updateTeam({ name: event.target.value })} />
              </label>
              <label className={styles.field}>描述
                <textarea rows={2} value={s.teamDraft.description} onChange={(event) => updateTeam({ description: event.target.value })} />
              </label>
              <div className={styles.field}>成员
                <div className={styles.memberPicker}>
                  <select
                    className={styles.memberSelect}
                    value={s.memberPickId}
                    disabled={s.availableProfiles.length === 0}
                    onChange={(event) => s.setMemberPickId(event.target.value)}
                  >
                    <option value="">选择要添加的智能体…</option>
                    {s.availableProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.displayName}（{profile.name}）</option>
                    ))}
                  </select>
                  <button className={styles.primary} disabled={s.memberPickId === '' || s.busy} onClick={s.addSelectedMember}>
                    <StudioIcon name="plus" size={14} />
                    添加
                  </button>
                </div>
                {s.availableProfiles.length === 0 && <p className={styles.empty}>所有智能体都已在团队里。</p>}
                <div className={styles.memberList}>
                  {s.teamDraft.members.map((member) => {
                    const profile = profileById(member.profileId)
                    return (
                      <div key={member.profileId} className={styles.memberRow}>
                        <span className={styles.memberIcon}><StudioIcon name="box" size={14} /></span>
                        <span className={styles.memberName}>
                          {profile?.displayName ?? '已删除智能体'}
                          <code>{profile?.name ?? member.profileId}</code>
                        </span>
                        <span className={styles.memberModel}>{profile?.model?.model ?? '继承模型'}</span>
                        <button className={styles.iconButtonDanger} onClick={() => s.removeMember(member.profileId)} aria-label="移除">
                          <StudioIcon name="trash" size={14} />
                        </button>
                      </div>
                    )
                  })}
                  {s.teamDraft.members.length === 0 && <p className={styles.empty}>还没有成员，从上面选择添加。</p>}
                </div>
              </div>
            </div>
            <footer className={styles.dialogFoot}>
              <button className={styles.secondary} onClick={() => s.setTeamDraft(null)}>取消</button>
              <button className={styles.primary} disabled={s.busy} onClick={s.saveTeam}>保存</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
