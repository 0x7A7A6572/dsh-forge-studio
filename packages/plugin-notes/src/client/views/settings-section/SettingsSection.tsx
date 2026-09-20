/**
 * dsh 设置 → **便签** 分区（slot: settings.section）。
 *
 * 注册见 src/client/index.ts：inject 面给 { notes, scope }，分区自己不再持 ctx。
 *
 * 基础分区：默认标题 / 默认工作区。默认工作区=任务便签未单独指定 workspace 时预置最近使用
 * 的目录。
 *
 * 备份分区（WebDAV）：
 * - 表单读写 forge-studio-notes 命名空间的 webdav 对象；
 * - 「保存并立即备份」：写配置成功后调 notes/webdavBackup （验证连通 +
 *   落首份快照），结果与最近状态就地回显（host 引擎执行，浏览器不直连 WebDAV）；
 * - 「恢复」：列远端快照 → 选一份 → 两步确认（会整体覆盖当前便签，引擎会先自动
 *   备份当前）→ 调 notes/webdavRestore，成功后刷新便签统计（板子靠宿主推送同步）。
 */

import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotesRemote } from '../../core/notes-remote.ts'
import type { NotesConfig, NotesEntryConfig } from '../../../types.ts'
import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from '../../core/theme-tokens.ts'
import { folderNameOf } from '../../core/workspace-path.ts'
import { SettingsCard } from '../../components/SettingsCard.tsx'
import { SettingsRow } from '../../components/SettingsRow.tsx'
import { SettingsSwitchRow } from '../../components/SettingsSwitchRow.tsx'
import { pluginVersion } from '../../../version.ts'
import { useSettingsSection, type SettingsGroup } from './useSettingsSection.ts'

/** 注册侧注入的业务面（见 src/client/index.ts）。 */
export interface NotesSettingsSectionInjected {
  /** notes 远程通道（工作区候选 + WebDAV 备份/列表/恢复/状态端点）。 */
  readonly notes: NotesRemote
  /** forge-studio-notes 命名空间 scope（读写 defaultTitle / defaultWorkspace / entry / webdav）。 */
  readonly scope: SettingsScope<NotesConfig>
}

/** 分区组件完整 props：设置外壳 owner props + 插件注入面。 */
export type SettingsSectionProps =
  PropsRuntime<'settings.section'> & InjectFace<NotesSettingsSectionInjected>

/** 分组（顺序即 tab 顺序）。 */
const SETTINGS_GROUPS: readonly { readonly id: SettingsGroup; readonly label: string }[] = [
  { id: 'general', label: '基础' },
  { id: 'entries', label: '入口' },
  { id: 'backup', label: '备份' },
]

/**
 * 入口开关清单。key 用 keyof 约束 —— 加了新入口却忘了在这里给文案，类型上就过不去。
 * 顺序 = 设置页里的展示顺序（先本体入口，再会话里的增量入口）。
 */
const ENTRY_ITEMS: readonly {
  readonly key: keyof NotesEntryConfig
  readonly label: string
  readonly hint: string
}[] = [
  { key: 'sidebarPanelIcon', label: '侧栏顶部入口', hint: '侧边栏顶部那一整行：[图标 便签 ......... 待办数 (＋)]，点行打开便签板，点 (＋) 只开快捷新建；关掉后便签板只能从别处打开。' },
  { key: 'inputToolbar', label: '输入栏工具条', hint: '输入框左下角那一条：记一笔 | 打开便签板 | 待办数。' },
  { key: 'quickAddOverlay', label: '快捷新建浮层', hint: '浮层本体；关掉后「记一笔」与侧栏 (＋) 都不会弹出。' },
  { key: 'saveMessageAction', label: '助手消息「存成便签」', hint: '每条助手回复下方的按钮，把该条回答收进便签。' },
  { key: 'rightSidebarGuide', label: '右侧栏导引卡片', hint: '右侧栏导引页里的便签卡片；点一下就在右侧栏以标签页打开便签板。' },
]

function fmtTime(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleString()
}

export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const {
    writable,
    group,
    setGroup,
    draft,
    setDraft,
    saving,
    dirty,
    saveDefaultTitle,
    overridden,
    workspaceOverridden,
    wsDraft,
    setWsDraft,
    wsSaving,
    wsDirty,
    saveDefaultWorkspace,
    wsOptions,
    wsLabels,
    notice,
    entryDraft,
    enabledCount,
    setEntry,
    wd,
    busy,
    patchWd,
    num,
    wdDirty,
    saveWebdav,
    openRestore,
    runRestore,
    status,
    showFiles,
    files,
    pick,
    setPick,
    armed,
    setArmed,
    setShowFiles,
  } = useSettingsSection(props.notes, props.scope)
  return (
    <div style={sectionStyle}>
      {/* 标题区：分区名 + 插件版本 + 一句说明 —— 与 memory / daily-log / usage-billing 的分区一致。 */}
      <div style={headerStyle}>
        <div style={titleRowStyle}>
          <h2 style={titleStyle}>便签</h2>
          <span style={versionStyle} title="插件版本">v{pluginVersion()}</span>
        </div>
        <p style={introStyle}>
          会话里随手记的便签板：记一笔、把待办挂成任务泳道、回头按列看进度。
          这里管默认值、各入口开关与 WebDAV 备份；便签板本身从侧栏顶部那一行打开。
        </p>
      </div>

      <nav style={tabBarStyle} role="tablist" aria-label="便签设置分区">
        {SETTINGS_GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={group === item.id}
            onClick={() => setGroup(item.id)}
            style={{ ...tabStyle, ...(group === item.id ? tabActiveStyle : {}) }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div style={paneStyle} role="tabpanel">
        {group === 'general' && (
          <SettingsCard title="默认值" desc="新建便签时用的缺省值。清空并保存可恢复系统默认。">
            <SettingsRow
              label="默认标题"
              badge={overridden ? <span style={{ color: t.stateWarn, fontSize: 12 }}>已覆盖</span> : null}
              hint="新建便签标题留空时使用。"
            >
              <Input
                value={draft}
                disabled={!writable || saving}
                placeholder="新便签"
                aria-label="默认标题"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveDefaultTitle()
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={!writable || saving || !dirty}
                  onClick={() => void saveDefaultTitle()}
                  style={{ ...btnPrimary, ...(!writable || saving || !dirty ? dimmed : {}) }}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </SettingsRow>

            <SettingsRow
              label="默认工作区"
              badge={workspaceOverridden ? <span style={{ color: t.stateWarn, fontSize: 12 }}>已覆盖</span> : null}
              hint="任务便签未单独指定工作区时，执行会以该目录新建会话。"
            >
              <select
                value={wsDraft}
                disabled={!writable || wsSaving}
                aria-label="默认工作区"
                title={wsDraft === '' ? '自动：优先最近会话用过的目录，其次宿主进程目录' : `工作区：${wsDraft}`}
                onChange={(e) => setWsDraft(e.target.value)}
                style={inputStyle}
              >
                <option value="">自动（最近使用的目录）</option>
                {wsOptions.map((option) => (
                  <option key={option} value={option} title={option}>
                    {wsLabels.get(option) ?? folderNameOf(option)}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={!writable || wsSaving || !wsDirty}
                  onClick={() => void saveDefaultWorkspace()}
                  style={{ ...btnPrimary, ...(!writable || wsSaving || !wsDirty ? dimmed : {}) }}
                >
                  {wsSaving ? '保存中…' : '保存默认工作区'}
                </button>
              </div>
            </SettingsRow>

            {notice !== null && group === 'general' && (
              <div style={noticeStyle(notice.kind)} role="status">
                {notice.kind === 'error' ? '⚠ ' : '✓ '}
                {notice.text}
              </div>
            )}
          </SettingsCard>
        )}

        {group === 'entries' && (
          <SettingsCard
            title="入口开关"
            desc="便签板的入口开关。"
          >
            {ENTRY_ITEMS.map((item) => {
              // 最后一个开着的：禁掉，否则用户会把自己锁在门外（见 types.ts）。
              const lastOne = entryDraft[item.key] && enabledCount <= 1
              return (
                <SettingsSwitchRow
                  key={item.key}
                  title={item.label}
                  desc={item.hint}
                  checked={entryDraft[item.key]}
                  disabled={!writable || lastOne}
                  {...(lastOne ? { lockReason: '至少要留一个入口' } : {})}
                  onChange={(next) => { void setEntry(item.key, next) }}
                />
              )
            })}
          </SettingsCard>
        )}

        {group === 'backup' && (
          <SettingsCard
            title="WebDAV 备份"
            desc="凭据只存本机设置；建议用服务商提供的「应用密码」而非主密码。备份只在便签有变更时上传。"
            extra={(
              <div style={{ ...switchLabel, cursor: 'default' }}>
                <Switch
                  checked={wd.enabled}
                  disabled={!writable || busy}
                  label="启用 WebDAV 备份"
                  onChange={(next) => patchWd({ enabled: next })}
                />
                <span style={{ fontSize: 12, color: t.labelSecondary }}>启用</span>
              </div>
            )}
          >
            <div style={gridStyle}>
              <SettingsRow label="服务器地址">
                <Input
                  value={wd.url}
                  disabled={!writable || busy}
                  placeholder="https://dav.jianguoyun.com/dav/"
                  onChange={(e) => patchWd({ url: e.target.value })}
                />
              </SettingsRow>
              <SettingsRow label="远端目录">
                <Input
                  value={wd.path}
                  disabled={!writable || busy}
                  placeholder="dsh/notes/"
                  onChange={(e) => patchWd({ path: e.target.value })}
                />
              </SettingsRow>
              <SettingsRow label="账号">
                <Input
                  value={wd.username}
                  disabled={!writable || busy}
                  autoComplete="off"
                  onChange={(e) => patchWd({ username: e.target.value })}
                />
              </SettingsRow>
              <SettingsRow label="应用密码">
                <Input
                  type="password"
                  value={wd.password}
                  disabled={!writable || busy}
                  autoComplete="new-password"
                  onChange={(e) => patchWd({ password: e.target.value })}
                />
              </SettingsRow>
              <SettingsRow label="检查间隔（分钟）">
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={String(wd.intervalMin)}
                  disabled={!writable || busy}
                  onChange={(e) => patchWd({ intervalMin: num(e.target.value, 30) })}
                />
              </SettingsRow>
              <SettingsRow label="保留份数">
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={String(wd.keep)}
                  disabled={!writable || busy}
                  onChange={(e) => patchWd({ keep: num(e.target.value, 10) })}
                />
              </SettingsRow>
            </div>

            {/* 最近状态 */}
            {status !== null && (
              <div style={statusStyle}>
                <div style={statusRow}>
                  <span style={statusKey}>上次备份</span>
                  <span style={{ ...statusVal, color: status.lastBackupOk ? t.success : status.lastBackupError ? t.danger : t.labelSecondary }}>
                    {fmtTime(status.lastBackupAt)}
                    {status.lastBackupName !== null && status.lastBackupOk && <span style={{ color: t.labelCaption }}> · {status.lastBackupName}</span>}
                    {status.lastBackupError !== null && status.lastBackupOk === false && (
                      <span style={{ color: t.danger }}> · {status.lastBackupError}</span>
                    )}
                  </span>
                </div>
                <div style={statusRow}>
                  <span style={statusKey}>最近恢复</span>
                  <span style={{ ...statusVal, color: status.lastRestoreOk ? t.success : status.lastRestoreOk === false ? t.danger : t.labelSecondary }}>
                    {fmtTime(status.lastRestoreAt)}
                    {status.lastRestoreName !== null && status.lastRestoreOk && <span style={{ color: t.labelCaption }}> · {status.lastRestoreName}</span>}
                  </span>
                </div>
              </div>
            )}

            {notice !== null && (
              <div style={noticeStyle(notice.kind)} role="status">
                {notice.kind === 'error' ? '⚠ ' : '✓ '}
                {notice.text}
              </div>
            )}

            {/* 恢复面板 */}
            {showFiles && files.length > 0 && (
              <div style={restorePanelStyle}>
                <select
                  value={pick}
                  disabled={busy}
                  onChange={(e) => {
                    setPick(e.target.value)
                    setArmed(false)
                  }}
                  style={selectStyle}
                >
                  {files.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={busy || pick === ''}
                    onClick={() => void runRestore()}
                    style={{
                      ...(armed ? btnDanger : btnPrimary),
                      ...(busy || pick === '' ? dimmed : {}),
                    }}
                  >
                    {armed ? '再次点击确认恢复' : '恢复所选快照'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setShowFiles(false)
                      setArmed(false)
                    }}
                    style={btnGhost}
                  >
                    取消
                  </button>
                </div>
                {armed && (
                  <span style={{ color: t.danger, fontSize: 12 }}>
                    恢复将整体覆盖当前便签（引擎会先自动备份当前状态）；仅选中的那份生效。
                  </span>
                )}
              </div>
            )}

            <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" disabled={!writable || busy} onClick={() => void openRestore()} style={btnGhost}>
                恢复…
              </button>
              <button
                type="button"
                disabled={!writable || busy || (!wdDirty && !wd.enabled)}
                onClick={() => void saveWebdav(false)}
                style={{ ...btnGhost, ...(!writable || busy || (!wdDirty && !wd.enabled) ? dimmed : {}) }}
              >
                仅保存配置
              </button>
              <button
                type="button"
                disabled={!writable || busy}
                onClick={() => void saveWebdav(true)}
                style={{ ...btnPrimary, ...(busy || !writable ? dimmed : {}) }}
              >
                {busy ? '处理中…' : wd.enabled ? '保存并立即备份' : '保存配置'}
              </button>
            </footer>
          </SettingsCard>
        )}
      </div>
    </div>
  )
}

/* ---------- 样式 ---------- */

/** 分区根：撑满设置面板的内容列；撑不开时（宿主不限高）也照常按内容自然生长。 */
const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  height: '100%',
  minHeight: 0,
  boxSizing: 'border-box',
}
/** 标题区外层：标题行与说明之间收紧一点（根上是 14px 的行间距，太散）。 */
const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  flex: 'none',
}
/** 标题行：分区名 + 版本号，基线对齐（与 memory / daily-log / usage-billing 同款）。 */
const titleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
}
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
  color: t.labelPrimary,
}
const versionStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: t.labelTertiary,
  fontVariantNumeric: 'tabular-nums',
}
/** 说明：一句话交代这个分区管什么、本体在哪。 */
const introStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: t.labelTertiary,
}
/** 分组 tab：横向一排胶囊（面板左列已经是分区导航，这里不再搭第二层左列）。 */
const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  flex: 'none',
}
const tabStyle: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: t.labelSecondary,
  fontSize: 13,
  cursor: 'pointer',
}
/** 选中态用中性半透明底：不依赖具体主题令牌，明暗两套都不刺眼。 */
const tabActiveStyle: React.CSSProperties = {
  background: 'rgba(127, 127, 127, 0.14)',
  color: t.labelPrimary,
  fontWeight: 600,
}
/** 内容列：卡片纵向堆叠；溢出时自己滚（宿主不限高时这一条不生效，交给外层）。 */
const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflowY: 'auto',
  paddingRight: 4,
}
const switchLabel: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
}
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '10px 12px',
}
const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: 30,
  padding: '0 8px',
  fontSize: 13,
  color: t.labelPrimary,
  background: t.surface,
  border: `1px solid ${t.borderL2}`,
  borderRadius: 8,
  outline: 'none',
}
const statusStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 10px',
  background: t.hoverBg,
  borderRadius: 8,
}
const statusRow: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'baseline',
}
const statusKey: React.CSSProperties = {
  flex: 'none',
  fontSize: 12,
  color: t.labelTertiary,
}
const statusVal: React.CSSProperties = {
  fontSize: 12,
  wordBreak: 'break-all',
}
const noticeStyle = (kind: 'info' | 'error'): React.CSSProperties => ({
  padding: '5px 10px',
  borderRadius: 8,
  fontSize: 12,
  color: kind === 'error' ? t.danger : t.success,
  background: kind === 'error' ? t.hoverDangerBg : t.hoverBg,
})
const restorePanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  border: `1px dashed ${t.borderL2}`,
  borderRadius: 8,
}
const selectStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  height: 30,
  padding: '0 8px',
  fontSize: 12,
  color: t.labelPrimary,
  background: t.surface,
  border: `1px solid ${t.borderL2}`,
  borderRadius: 8,
  outline: 'none',
}
const btnBase: React.CSSProperties = {
  height: 28,
  padding: '0 12px',
  fontSize: 12,
  borderRadius: 8,
  cursor: 'pointer',
  border: 'none',
}
const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: t.primaryFill,
  color: t.onPrimary,
}
const btnGhost: React.CSSProperties = {
  ...btnBase,
  background: 'transparent',
  color: t.labelPrimary,
  border: `1px solid ${t.borderL2}`,
}
const btnDanger: React.CSSProperties = {
  ...btnBase,
  background: t.danger,
  color: t.onPrimary,
}
const dimmed: React.CSSProperties = {
  opacity: 0.45,
  cursor: 'default',
}
