/**
 * 便签板设置弹窗：默认标题（既有）+ WebDAV 备份分区（新增）。
 *
 * WebDAV 分区：
 * - 表单读写 forge-studio-notes 命名空间的 webdav 对象（与应用密码一起存本地
 *   settings，不做云上云；文案提示用服务商「应用密码」）；
 * - 「保存并立即备份」：写配置成功后调 notes/webdavBackup 试跑一次（验证连通 +
 *   落首份快照），结果与最近状态就地回显（host 引擎执行，浏览器不直连 WebDAV）；
 * - 「恢复」：列远端快照 → 选一份 → 两步确认（会整体覆盖当前便签，引擎会先自动
 *   备份当前）→ 调 notes/webdavRestore，成功后通知父级刷新便签列表。
 */

import { useEffect, useState } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotesRemote } from '../core/notes-remote.ts'
import type { NotesConfig, WebdavStatus } from '../../types.ts'
import { DEFAULT_WEBDAV_CONFIG } from '../../types.ts'
import type { NotesWebdavConfig } from '../../types.ts'
import { t } from '../core/theme-tokens.ts'
import { X } from 'lucide-react'

export interface NotesSettingsDialogProps {
  /** forge-studio-notes 命名空间 scope（读写 defaultTitle / webdav）。 */
  readonly scope: SettingsScope<NotesConfig>
  /** 当前快照（用于展示当前值与覆盖态）。 */
  readonly snapshot: SettingsScopeSnapshot<NotesConfig>
  /** notes 远程通道（WebDAV 备份/列表/恢复/状态端点）。 */
  readonly notes: NotesRemote
  /** 保存/恢复成功后通知父级刷新列表。 */
  readonly onDataChanged: () => void
  /** 保存失败回调（供上层展示错误条）。 */
  readonly onError?: (message: string) => void
  readonly onClose: () => void
}

type Notice = { readonly kind: 'info' | 'error'; readonly text: string } | null

function fmtTime(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleString()
}

/**
 * remote 传输层失败（result.ok=false）时的可读原因：优先用网关 error.message
 * （如「方法未注册」/调用异常），没有才落到调用方兜底文案。
 */
function transportReason(result: { readonly ok?: boolean; readonly error?: { readonly message?: string } }, fallback: string): string {
  const message = result.error?.message?.trim()
  return message !== undefined && message !== '' ? message : fallback
}

export function NotesSettingsDialog(props: NotesSettingsDialogProps): JSX.Element {
  const current = props.snapshot.value?.defaultTitle ?? '新便签'
  const overridden =
    props.snapshot.user !== undefined && 'defaultTitle' in (props.snapshot.user as object)
  const writable = props.snapshot.writable
  const [draft, setDraft] = useState(current)
  const [saving, setSaving] = useState(false)
  const dirty = draft.trim() !== current

  // ---- WebDAV 分区状态 ----
  const [wd, setWd] = useState<NotesWebdavConfig>({
    ...DEFAULT_WEBDAV_CONFIG,
    ...(props.snapshot.value?.webdav ?? {}),
  })
  const [wdDirty, setWdDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<WebdavStatus | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [files, setFiles] = useState<readonly string[]>([])
  const [showFiles, setShowFiles] = useState(false)
  const [pick, setPick] = useState('')
  const [armed, setArmed] = useState(false)

  const patchWd = (patch: Partial<NotesWebdavConfig>): void => {
    setWd((prev) => ({ ...prev, ...patch }))
    setWdDirty(true)
  }
  const num = (raw: string, fallback: number): number => {
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : fallback
  }

  async function refreshStatus(): Promise<void> {
    try {
      const result = await props.notes.webdavStatus()
      if (result.ok) setStatus(result.value)
    } catch {
      // 状态查询失败静默（非关键路径）。
    }
  }

  useEffect(() => {
    void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveDefaultTitle(): Promise<void> {
    if (!writable || !dirty || saving) return
    setSaving(true)
    try {
      const trimmed = draft.trim()
      if (trimmed === '') await props.scope.unset('defaultTitle')
      else await props.scope.set('defaultTitle', trimmed)
      props.onClose()
    } catch (cause) {
      props.onError?.(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  /** 保存 WebDAV 配置；enabled 时随即试跑一次备份（验证连通 + 落首份）。 */
  async function saveWebdav(andBackup: boolean): Promise<void> {
    if (!writable || busy) return
    const next: NotesWebdavConfig = {
      ...wd,
      url: wd.url.trim(),
      username: wd.username.trim(),
      path: wd.path.trim().replace(/^\/+/, '').replace(/\/+$/, '') + '/',
      intervalMin: Math.min(1440, Math.max(1, wd.intervalMin)),
      keep: Math.min(99, Math.max(1, wd.keep)),
    }
    setBusy(true)
    setNotice(null)
    try {
      await props.scope.set('webdav', next)
      setWd(next)
      setWdDirty(false)
      if (andBackup && next.enabled) {
        const result = await props.notes.webdavBackup()
        if (result.ok && result.value.ok) {
          setNotice({ kind: 'info', text: `备份成功：${result.value.snapshot}` })
        } else {
          const reason = result.ok && !result.value.ok ? result.value.reason : transportReason(result, '备份请求失败')
          setNotice({ kind: 'error', text: `备份失败：${reason}` })
        }
      } else {
        setNotice({ kind: 'info', text: next.enabled ? '配置已保存（定时备份按间隔自动执行）' : '配置已保存（未启用）' })
      }
      await refreshStatus()
    } catch (cause) {
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  /** 打开恢复面板：列远端快照供选择。 */
  async function openRestore(): Promise<void> {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setFiles([])
    setArmed(false)
    try {
      const result = await props.notes.webdavList()
      if (result.ok && result.value.ok) {
        setFiles(result.value.files)
        setPick(result.value.files[0] ?? '')
        setShowFiles(true)
        if (result.value.files.length === 0) {
          setNotice({ kind: 'error', text: '远端没有可用快照（先「保存并立即备份」）' })
        }
      } else {
        const reason = result.ok && !result.value.ok ? result.value.reason : transportReason(result, '列取失败')
        setNotice({ kind: 'error', text: reason })
      }
    } catch (cause) {
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  /** 恢复执行（两步确认：点一下进入确认态，再点一次真正执行）。 */
  async function runRestore(): Promise<void> {
    if (busy || pick === '') return
    if (!armed) {
      setArmed(true)
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const result = await props.notes.webdavRestore(pick)
      if (result.ok && result.value.ok) {
        setNotice({ kind: 'info', text: `已从 ${result.value.from} 恢复 ${result.value.restored} 条便签` })
        props.onDataChanged()
      } else {
        const reason = result.ok && !result.value.ok ? result.value.reason : transportReason(result, '恢复请求失败')
        setNotice({ kind: 'error', text: `恢复失败：${reason}` })
      }
      await refreshStatus()
      setShowFiles(false)
      setFiles([])
      setPick('')
      setArmed(false)
    } catch (cause) {
      setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fs-note-overlay" style={overlayStyle} onClick={props.onClose}>
      <div className="fs-note-dialog" style={cardStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="便签板设置">
        <header style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 14, color: t.labelPrimary }}>便签板设置</span>
          <button type="button" title="关闭" aria-label="关闭" onClick={props.onClose} style={iconBtn}>
            <X size={14} />
          </button>
        </header>

        {/* 默认标题（既有块） */}
        <label style={fieldStyle}>
          <span style={{ fontWeight: 600, fontSize: 13, color: t.labelPrimary }}>
            默认标题
            {overridden && <span style={{ color: t.stateWarn, fontSize: 12, marginLeft: 6 }}>已覆盖</span>}
          </span>
          <input
            value={draft}
            disabled={!writable || saving}
            placeholder="新便签"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveDefaultTitle()
            }}
            style={inputStyle}
          />
          <span style={{ color: t.labelCaption, fontSize: 12 }}>新建便签标题留空时使用的默认标题；清空并保存可恢复系统默认</span>
        </label>

        <div style={dividerStyle} />

        {/* WebDAV 备份分区 */}
        <section aria-label="WebDAV 备份" style={sectionStyle}>
          <header style={sectionHeaderStyle}>
            <span style={{ fontWeight: 600, fontSize: 13, color: t.labelPrimary }}>WebDAV 备份</span>
            <label style={switchLabel}>
              <input
                type="checkbox"
                checked={wd.enabled}
                disabled={!writable || busy}
                onChange={(e) => patchWd({ enabled: e.target.checked })}
                style={{ accentColor: 'var(--dsw-static-deepseek-450)' }}
              />
              <span style={{ fontSize: 12, color: t.labelSecondary }}>启用</span>
            </label>
          </header>

          <div style={gridStyle}>
            <label style={fieldStyle}>
              <span style={fieldTitle}>服务器地址</span>
              <input
                value={wd.url}
                disabled={!writable || busy}
                placeholder="https://dav.jianguoyun.com/dav/"
                onChange={(e) => patchWd({ url: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={fieldTitle}>远端目录</span>
              <input
                value={wd.path}
                disabled={!writable || busy}
                placeholder="dsh/notes/"
                onChange={(e) => patchWd({ path: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={fieldTitle}>账号</span>
              <input
                value={wd.username}
                disabled={!writable || busy}
                autoComplete="off"
                onChange={(e) => patchWd({ username: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={fieldTitle}>应用密码</span>
              <input
                type="password"
                value={wd.password}
                disabled={!writable || busy}
                autoComplete="new-password"
                onChange={(e) => patchWd({ password: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={fieldTitle}>检查间隔（分钟）</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={String(wd.intervalMin)}
                disabled={!writable || busy}
                onChange={(e) => patchWd({ intervalMin: num(e.target.value, 30) })}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={fieldTitle}>保留份数</span>
              <input
                type="number"
                min={1}
                max={99}
                value={String(wd.keep)}
                disabled={!writable || busy}
                onChange={(e) => patchWd({ keep: num(e.target.value, 10) })}
                style={inputStyle}
              />
            </label>
          </div>

          <span style={{ color: t.labelCaption, fontSize: 12 }}>
            凭据只存本机设置；建议使用服务商提供的「应用密码」而非主密码。备份仅在便签有变更时上传，节省流量。
          </span>

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
        </section>
      </div>
    </div>
  )
}

/* ---------- 样式 ---------- */

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: t.mask,
}
const cardStyle: React.CSSProperties = {
  width: 'min(560px, 94%)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
  background: t.surfaceRaised,
  border: `1px solid ${t.borderL2}`,
  borderRadius: 12,
  boxShadow: t.shadowLv3,
  maxHeight: '90%',
  overflowY: 'auto',
}
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}
const dividerStyle: React.CSSProperties = {
  borderTop: `1px solid ${t.borderL1}`,
}
const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}
const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
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
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  minWidth: 0,
}
const fieldTitle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: t.labelSecondary,
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
const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  color: t.labelSecondary,
  cursor: 'pointer',
}