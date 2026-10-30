import type { AgentProfile } from '../../../types.ts'
import type { AgentStudioRemote } from '../../core/remote.ts'
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

  const updateProfile = (patch: Partial<AgentProfile>): void => {
    if (s.profileDraft === null) return
    s.setProfileDraft({ ...s.profileDraft, ...patch })
  }

  return (
    <section className={styles.root} data-dsh-part="agent-studio-settings">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>智能体工坊</h2>
          <p className={styles.hint}>定义单 Agent / 团队模板；在会话头部选择并启动。</p>
        </div>
        <button className={styles.primary} onClick={() => s.tab === 'profiles' ? s.newProfile() : s.newTeam()}>
          + 新建{s.tab === 'profiles' ? ' Agent' : '团队'}
        </button>
      </header>

      <div className={styles.tabs}>
        <button className={s.tab === 'profiles' ? styles.tabActive : styles.tab} onClick={() => s.setTab('profiles')}>Agent</button>
        <button className={s.tab === 'teams' ? styles.tabActive : styles.tab} onClick={() => s.setTab('teams')}>团队</button>
      </div>

      {s.error !== '' && <p className={styles.error}>{s.error}</p>}

      {s.tab === 'profiles' && (
        <div className={styles.columns}>
          <div className={styles.list}>
            {s.profiles.map((profile) => (
              <article key={profile.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <strong>{profile.displayName}</strong>
                  <span className={styles.code}>{profile.name}</span>
                </div>
                <p className={styles.cardText}>{profile.description || '（无描述）'}</p>
                <p className={styles.cardMeta}>{profile.model?.model ?? '继承模型'} · {profile.presetId ?? '继承 preset'}</p>
                <div className={styles.actions}>
                  <button className={styles.secondary} onClick={() => s.setProfileDraft(profile)}>编辑</button>
                  <button className={styles.danger} onClick={() => s.removeProfile(profile.id)}>删除</button>
                </div>
              </article>
            ))}
            {s.profiles.length === 0 && <p className={styles.empty}>还没有 Agent。点右上角新建。</p>}
          </div>

          {s.profileDraft !== null && (
            <div className={styles.editor}>
              <label className={styles.field}>名字（lower-kebab）
                <input value={s.profileDraft.name} onChange={(event) => updateProfile({ name: event.target.value })} />
              </label>
              <label className={styles.field}>显示名
                <input value={s.profileDraft.displayName} onChange={(event) => updateProfile({ displayName: event.target.value })} />
              </label>
              <label className={styles.field}>职责描述
                <input value={s.profileDraft.description} onChange={(event) => updateProfile({ description: event.target.value })} />
              </label>
              <label className={styles.field}>角色提示词
                <textarea rows={5} value={s.profileDraft.rolePrompt} onChange={(event) => updateProfile({ rolePrompt: event.target.value })} />
              </label>
              <label className={styles.field}>默认任务
                <textarea rows={3} value={s.profileDraft.defaultTask} onChange={(event) => updateProfile({ defaultTask: event.target.value })} />
              </label>
              <label className={styles.field}>Preset
                <select value={s.profileDraft.presetId ?? ''} onChange={(event) => updateProfile({ presetId: event.target.value === '' ? undefined : event.target.value })}>
                  <option value="">继承 Lead / 部署默认</option>
                  {s.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              </label>
              <div className={styles.row}>
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
              <div className={styles.row}>
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
              <div className={styles.actions}>
                <button className={styles.primary} disabled={s.busy} onClick={s.saveProfile}>保存</button>
                <button className={styles.secondary} onClick={() => s.setProfileDraft(null)}>关闭</button>
              </div>
            </div>
          )}
        </div>
      )}

      {s.tab === 'teams' && (
        <div className={styles.columns}>
          <div className={styles.list}>
            {s.teams.map((team) => (
              <article key={team.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <strong>{team.name}</strong>
                  <span className={styles.code}>{team.members.length} 人</span>
                </div>
                <p className={styles.cardText}>{team.description || '（无描述）'}</p>
                <p className={styles.cardMeta}>{team.members.map((member) => member.name).join(' · ')}</p>
                <div className={styles.actions}>
                  <button className={styles.secondary} onClick={() => s.setTeamDraft(team)}>编辑</button>
                  <button className={styles.danger} onClick={() => s.removeTeam(team.id)}>删除</button>
                </div>
              </article>
            ))}
            {s.teams.length === 0 && <p className={styles.empty}>还没有团队。点右上角新建。</p>}
          </div>

          {s.teamDraft !== null && (
            <div className={styles.editor}>
              <label className={styles.field}>团队名
                <input value={s.teamDraft.name} onChange={(event) => s.setTeamDraft({ ...s.teamDraft!, name: event.target.value })} />
              </label>
              <label className={styles.field}>描述
                <textarea rows={3} value={s.teamDraft.description} onChange={(event) => s.setTeamDraft({ ...s.teamDraft!, description: event.target.value })} />
              </label>
              <div className={styles.field}>成员
                <div className={styles.actions}>
                  {s.profiles.map((profile) => (
                    <button key={profile.id} className={styles.secondary} onClick={() => s.addMember(profile)}>+ {profile.displayName}</button>
                  ))}
                </div>
                {s.teamDraft.members.map((member) => (
                  <div key={member.id} className={styles.memberRow}>
                    <span>{member.displayName}（{member.name}）</span>
                    <span className={styles.cardMeta}>{member.model?.model ?? '继承模型'}</span>
                    <button className={styles.danger} onClick={() => s.removeMember(member.id)}>移除</button>
                  </div>
                ))}
              </div>
              <div className={styles.actions}>
                <button className={styles.primary} disabled={s.busy} onClick={s.saveTeam}>保存</button>
                <button className={styles.secondary} onClick={() => s.setTeamDraft(null)}>关闭</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
