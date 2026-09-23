/**
 * 「设置 → 便签」分区的全部状态与动作：基础默认值 / 入口开关 / WebDAV 备份。
 *
 * 视图只读返回值，自己永远不碰 remote 与 scope。
 *
 * 为什么不拆成三块：三块共用同一条写结果通道（notice / writable）—— 入口开关写失败要回滚并
 * 报到同一个 notice，备份保存后要刷状态、恢复成功要刷便签统计；状态互相写，硬拆只能靠参数
 * 传写口子、造出两个假边界（CONVENTIONS.md：分块的红线是有没有环）。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotesRemote } from '../../core/notes-remote.ts'
import type { NoteOpenMode, NotesConfig, NotesEntryConfig, WebdavStatus } from '../../../types.ts'
import { DEFAULT_NOTES_ENTRY_CONFIG, DEFAULT_WEBDAV_CONFIG, enabledEntryCount, notesOpenMode } from '../../../types.ts'
import type { NotesWebdavConfig } from '../../../types.ts'
import { refreshNotesStats } from '../../core/notes-stats.ts'

type Notice = { readonly kind: 'info' | 'error'; readonly text: string } | null

/** 分区内的分组（横向 tab）。 */
export type SettingsGroup = 'general' | 'entries' | 'backup'

/**
 * remote 传输层失败（result.ok=false）时的可读原因：优先用网关 error.message
 * （如「方法未注册」/调用异常），没有才落到调用方兜底文案。
 */
function transportReason(result: { readonly ok?: boolean; readonly error?: { readonly message?: string } }, fallback: string): string {
  const message = result.error?.message?.trim()
  return message !== undefined && message !== '' ? message : fallback
}

/**
 * 写一次配置，返回失败原因（成功 = null）。
 *
 * dsh 0.1.7 起表单写入面（set/unset/mutate）**拒绝时 resolve false**（旧版
 * SettingsScope 的写入是抛异常），传输层错误才 reject —— 两种都要当写失败处理。
 */
async function writeConfig(action: () => Promise<boolean>, fallback: string): Promise<string | null> {
  try {
    return (await action()) ? null : fallback
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

export function useSettingsSection(notes: NotesRemote, scope: ConfigForm<NotesConfig>) {
  // 订阅本插件配置表单：写完之后当前值与「已覆盖」标记要立刻跟上，不等重新打开设置。
  const snapshot = useSyncExternalStore(
    (cb) => scope.subscribe(cb),
    () => scope.getSnapshot(),
  )
  const writable = snapshot.writable

  // ---- 基础分区状态 ----
  const current = snapshot.value?.defaultTitle ?? '新便签'
  const overridden = snapshot.user !== undefined && 'defaultTitle' in (snapshot.user as object)
  const [draft, setDraft] = useState(current)
  const [saving, setSaving] = useState(false)
  const dirty = draft.trim() !== current


  // ---- 备份分区（WebDAV）状态 ----
  const [wd, setWd] = useState<NotesWebdavConfig>({
    ...DEFAULT_WEBDAV_CONFIG,
    ...(snapshot.value?.webdav ?? {}),
  })
  const [wdDirty, setWdDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<WebdavStatus | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [files, setFiles] = useState<readonly string[]>([])
  const [showFiles, setShowFiles] = useState(false)
  const [pick, setPick] = useState('')
  const [armed, setArmed] = useState(false)

  // ---- tab + 入口开关 ----
  const [group, setGroup] = useState<SettingsGroup>('general')
  // 入口开关留本地副本：设置快照不保证随写即时回传，本地状态让勾选立刻响应，
  // 写失败再回滚（否则用户会看到一个「勾上了但其实没存」的假象）。
  const [entryDraft, setEntryDraft] = useState<NotesEntryConfig>(
    () => snapshot.value?.entry ?? DEFAULT_NOTES_ENTRY_CONFIG,
  )

  /**
   * 打开方式：同样留本地副本，改完立刻落配置 —— 与入口开关一样没有「保存」按钮，
   * 写失败回滚。快照里可能是旧值 / 手改坏的字符串，统一走 notesOpenMode 归一。
   */
  const [openMode, setOpenModeDraft] = useState<NoteOpenMode>(() => notesOpenMode(snapshot.value))

  /** 已开启的入口数量：靠它守住「至少留一个」。 */
  const enabledCount = enabledEntryCount(entryDraft)

  /** 写一个入口开关：先本地生效，再落配置。 */
  async function setEntry(key: keyof NotesEntryConfig, value: boolean): Promise<void> {
    if (!writable) return
    // 至少留一个：把最后一个开着的入口也关掉，便签板就一个打开的地方都没有了。
    // 设置页会把那个开关禁掉，这里再挡一道，防别的调用路径绕过去。
    if (!value && enabledCount <= 1 && entryDraft[key]) return
    const previous = entryDraft
    const next = { ...entryDraft, [key]: value }
    setEntryDraft(next)
    const failure = await writeConfig(() => scope.set('entry', next), '配置写入被拒绝（当前没有写权限）')
    if (failure !== null) {
      setEntryDraft(previous)
      setNotice({ kind: 'error', text: failure })
    }
  }

  /** 改打开方式：本地先生效，再落配置；失败回滚并报到 notice。 */
  async function setOpenMode(next: NoteOpenMode): Promise<void> {
    if (!writable) return
    const previous = openMode
    setOpenModeDraft(next)
    const failure = await writeConfig(() => scope.set('openMode', next), '配置写入被拒绝（当前没有写权限）')
    if (failure !== null) {
      setOpenModeDraft(previous)
      setNotice({ kind: 'error', text: failure })
    }
  }

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
      const result = await notes.webdavStatus()
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
    const trimmed = draft.trim()
    const failure = trimmed === ''
      ? await writeConfig(() => scope.unset('defaultTitle'), '配置写入被拒绝（当前没有写权限）')
      : await writeConfig(() => scope.set('defaultTitle', trimmed), '配置写入被拒绝（当前没有写权限）')
    if (failure === null) setNotice({ kind: 'info', text: '默认标题已保存' })
    else setNotice({ kind: 'error', text: failure })
    setSaving(false)
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
    const failure = await writeConfig(() => scope.set('webdav', next), '配置写入被拒绝（当前没有写权限）')
    if (failure !== null) {
      setNotice({ kind: 'error', text: failure })
      setBusy(false)
      return
    }
    try {
      setWd(next)
      setWdDirty(false)
      if (andBackup && next.enabled) {
        const result = await notes.webdavBackup()
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
      const result = await notes.webdavList()
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
      const result = await notes.webdavRestore(pick)
      if (result.ok && result.value.ok) {
        setNotice({ kind: 'info', text: `已从 ${result.value.from} 恢复 ${result.value.restored} 条便签` })
        // 板子靠宿主推送同步，这里只把侧栏/工具条的待办计数立刻刷一遍。
        void refreshNotesStats()
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

  return {
    writable,
    group,
    setGroup,
    draft,
    setDraft,
    saving,
    dirty,
    saveDefaultTitle,
    overridden,
    notice,
    entryDraft,
    enabledCount,
    setEntry,
    openMode,
    setOpenMode,
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
  }
}
