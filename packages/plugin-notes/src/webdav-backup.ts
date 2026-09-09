/**
 * plugin-notes WebDAV 备份引擎（host 侧）。网络操作全部在此：浏览器 client 不
 * 直连 WebDAV（避开 CORS），只经 notes/webdav* remote 端点触发与查询。
 *
 * 职责：
 * - 配置读取（ctx.settings 命名空间，缺省合并）与有效性检查；
 * - 上推：整域序列化为带 schema 版本的 JSON → PUT 到 {url}{path}notes-*.json，
 *   HTTP Basic + HTTPS；成功后按 keep 清理最旧快照；
 * - watermark：meta 记已传最大 updatedAt，自动检查只在「到期且确有变更」时上传
 *   （省 WebDAV 流量）；手动/配置保存后的立即备份恒上传一次（验证连通）；
 * - 恢复：先自动上推当前快照（保险）→ GET 校验 payload → 全量重建便签；
 * - meta 状态（上次备份/恢复时间结果）落 notes_webdav 域，供设置弹窗展示。
 *
 * 失败隔离：一切网络/配置错误都转成结构化 { ok:false, reason } 并记入 meta，
 * 绝不抛出到调用方（remote 端点与定时循环都安全）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NOTES_NAMESPACE } from './types.ts'
import { DEFAULT_WEBDAV_CONFIG } from './types.ts'
import type { NotesConfig, NotesWebdavConfig } from './types.ts'
import type {
  WebdavBackupResult,
  WebdavListResult,
  WebdavRestoreResult,
  WebdavStatus,
} from './types.ts'
import type { NoteRecord } from './types.ts'
import type { WebdavMeta } from './webdav-domain.ts'
import { emptyWebdavMeta, WEBDAV_META_KEY } from './webdav-domain.ts'
import {
  backupFileName,
  buildBackupPayload,
  compareSnapshotNamesDesc,
  uniqueBackupName,
  filterBackupFiles,
  isBackupFileName,
  maxUpdatedAt,
  parseHrefs,
  selectPruneNames,
  shouldUpload,
  validateBackupPayload,
} from './webdav-core.ts'

/** 单个 WebDAV 请求超时。 */
const REQUEST_TIMEOUT_MS = 20_000

export interface WebdavEngineOptions {
  /** 当前全部便签（含归档；恢复前自动备份需要全量）。 */
  readonly listNotes: () => readonly NoteRecord[]
  /** 全量重建便签（仅恢复流程使用；host 可信，跳过 origin guard）。 */
  readonly replaceAll: (notes: readonly NoteRecord[]) => Promise<void>
  /** notes_webdav 域 meta 表。 */
  readonly metaTable: KvTable<string, WebdavMeta>
}

/** host 侧引擎给 NotesService remote 端点用的窄接口。 */
export interface WebdavRunner {
  backupNow(): Promise<WebdavBackupResult>
  listFiles(): Promise<WebdavListResult>
  restore(target: string): Promise<WebdavRestoreResult>
  status(): Promise<WebdavStatus>
  /** 定时检查（由调度 interval 调用；内部消化一切错误）。 */
  checkAutomatic(): Promise<void>
}

function normalizeDir(dir: string): string {
  const trimmed = dir.trim().replace(/^\/+/u, '').replace(/\/+$/u, '')
  return trimmed.length === 0 ? '' : trimmed + '/'
}

function normalizeBase(url: string): string {
  const trimmed = url.trim()
  return trimmed.endsWith('/') ? trimmed : trimmed + '/'
}

export function createWebdavEngine(ctx: Context, options: WebdavEngineOptions): WebdavRunner {
  /**
   * 读取 WebDAV 配置。cordis 规则：ctx.settings 必须在声明了 inject(['settings'])
   * 的上下文里读取——service 执行上下文没声明时直接 ctx.settings 会抛
   * "cannot get property \"settings\" without inject"。这里每次经
   * ctx.inject(['settings']) 派生带 settings 的上下文取当前值（改配置立即生效）；
   * settings 服务缺席/5s 内不可用返回 null（各操作自行降级，不悬死）。
   */
  const currentConfig = (): Promise<NotesWebdavConfig | null> =>
    new Promise((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          resolve(null)
        }
      }, 5000)
      void ctx.inject(['settings'], (settingsCtx) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          const raw = settingsCtx.settings.get(NOTES_NAMESPACE) as Partial<NotesConfig> | undefined
          resolve({ ...DEFAULT_WEBDAV_CONFIG, ...(raw?.webdav ?? {}) })
        } catch {
          resolve(null)
        }
      })
    })

  const metaGet = async (): Promise<WebdavMeta> => {
    return options.metaTable.get(WEBDAV_META_KEY) ?? emptyWebdavMeta()
  }
  const metaPut = async (meta: WebdavMeta): Promise<void> => {
    await options.metaTable.put(WEBDAV_META_KEY, meta)
  }

  /** 配置有效性：返回错误文案或 null。 */
  const configError = (cfg: NotesWebdavConfig): string | null => {
    if (!cfg.enabled) return 'WebDAV 未启用'
    if (!/^https?:\/\//iu.test(cfg.url.trim())) return '服务器地址须为 http(s):// 完整 URL'
    if (cfg.username.trim() === '') return '缺少账号'
    if (cfg.password === '') return '缺少应用密码'
    return null
  }

  const authHeader = (cfg: NotesWebdavConfig): string => {
    const token = Buffer.from(`${cfg.username}:${cfg.password}`, 'utf8').toString('base64')
    return `Basic ${token}`
  }

  async function dav(
    cfg: NotesWebdavConfig,
    method: string,
    relative: string,
    body?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(normalizeBase(cfg.url) + relative, {
        method,
        headers: {
          Authorization: authHeader(cfg),
          ...(body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
          ...extraHeaders,
        },
        body,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /** 确保远端目录存在：按 / 分段逐级 MKCOL；已存在（405/2xx）视为成功。 */
  async function ensureRemoteDir(cfg: NotesWebdavConfig): Promise<void> {
    const dir = normalizeDir(cfg.path)
    if (dir === '') return
    let acc = ''
    for (const segment of dir.split('/').filter(Boolean)) {
      acc += segment + '/'
      const res = await dav(cfg, 'MKCOL', acc)
      const ok = res.ok || res.status === 301 || res.status === 302 || res.status === 405
      if (!ok) throw new Error(`创建远端目录失败（${acc}，HTTP ${res.status}）`)
    }
  }

  /** 远端目录快照名列表（desc 时间序）；目录不存在时先建目录再列。 */
  async function remoteSnapshotNames(cfg: NotesWebdavConfig): Promise<string[]> {
    const dir = normalizeDir(cfg.path)
    let res = await dav(cfg, 'PROPFIND', dir, undefined, { Depth: '1' })
    if (!res.ok && (res.status === 404 || res.status === 409)) {
      await ensureRemoteDir(cfg)
      res = await dav(cfg, 'PROPFIND', dir, undefined, { Depth: '1' })
    }
    if (!res.ok) throw new Error(`列取远端目录失败（HTTP ${res.status}）`)
    const text = await res.text()
    const names = parseHrefs(text)
      .map((href) => href.split('/').pop() ?? '')
      .filter((name) => isBackupFileName(name))
      .sort(compareSnapshotNamesDesc)
    return names
  }

  async function putSnapshot(cfg: NotesWebdavConfig, notes: readonly NoteRecord[]): Promise<string> {
    // 撞名去重：先列当前快照名，同一秒重复备份时用 -N 后缀，避免 PUT 覆盖旧快照。
    const existing = new Set(await remoteSnapshotNames(cfg))
    const name = uniqueBackupName(backupFileName(), existing)
    const payload = buildBackupPayload(notes)
    const dir = normalizeDir(cfg.path)
    let res = await dav(cfg, 'PUT', dir + name, JSON.stringify(payload))
    if (!res.ok && (res.status === 409 || res.status === 404)) {
      await ensureRemoteDir(cfg)
      res = await dav(cfg, 'PUT', dir + name, JSON.stringify(payload))
    }
    if (!res.ok) throw new Error(`上传备份失败（HTTP ${res.status}）`)
    return name
  }

  async function pruneOld(cfg: NotesWebdavConfig, justUploaded: string): Promise<void> {
    const keep = Math.max(1, Math.floor(cfg.keep) || 1)
    const dir = normalizeDir(cfg.path)
    const names = await remoteSnapshotNames(cfg)
    const prune = selectPruneNames(names.filter((n) => n !== justUploaded), keep)
    for (const name of prune) {
      try {
        const res = await dav(cfg, 'DELETE', dir + name)
        if (!res.ok && res.status !== 404) {
          ctx.logger.warn('[plugin-notes] webdav prune failed:', name, res.status)
        }
      } catch (error) {
        ctx.logger.warn('[plugin-notes] webdav prune failed:', name, error)
      }
    }
  }

  /** 实际上传一份（无论有无变更；手动/改配置即试跑用）。失败落 meta 并返回结果。 */
  async function backupNow(): Promise<WebdavBackupResult> {
    const fail = async (reason: string): Promise<WebdavBackupResult> => {
      const meta = await metaGet()
      await metaPut({ ...meta, lastBackupAt: Date.now(), lastBackupOk: false, lastBackupError: reason })
      return { ok: false, reason }
    }
    const webdav = await currentConfig()
    if (webdav === null) return fail('无法读取 WebDAV 配置（settings 服务不可用）')
    const invalid = configError(webdav)
    if (invalid !== null) return fail(invalid)
    try {
      const notes = options.listNotes()
      const name = await putSnapshot(webdav, notes)
      await pruneOld(webdav, name)
      const meta = await metaGet()
      await metaPut({
        ...meta,
        lastBackupAt: Date.now(),
        lastBackupName: name,
        lastBackupOk: true,
        lastBackupError: null,
        watermark: maxUpdatedAt(notes),
      })
      return { ok: true, snapshot: name }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  /** 定时自动检查：启用 + 到期（距上次成功 ≥ intervalMin）+ 确有变更才传。 */
  async function checkAutomatic(): Promise<void> {
    const webdav = await currentConfig()
    if (webdav === null || configError(webdav) !== null) return
    const meta = await metaGet()
    const now = Date.now()
    const due =
      meta.lastBackupAt === null ||
      now - meta.lastBackupAt >= Math.max(1, webdav.intervalMin) * 60_000
    if (!due) return
    const notes = options.listNotes()
    if (!shouldUpload(maxUpdatedAt(notes), meta.watermark)) return
    await backupNow()
  }

  /** 列远端快照（ok 分支返回 desc 时间序文件名）。 */
  async function listFiles(): Promise<WebdavListResult> {
    const webdav = await currentConfig()
    if (webdav === null) return { ok: false, reason: '无法读取 WebDAV 配置（settings 服务不可用）' }
    const invalid = configError(webdav)
    if (invalid !== null) return { ok: false, reason: invalid }
    try {
      const names = await remoteSnapshotNames(webdav)
      return { ok: true, files: names }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 恢复：先自动备份当前 → 拉取校验 → 全量重建。target='latest' 取最新一份。 */
  async function restore(target: string): Promise<WebdavRestoreResult> {
    const webdav = await currentConfig()
    if (webdav === null) return { ok: false, reason: '无法读取 WebDAV 配置（settings 服务不可用）' }
    const invalid = configError(webdav)
    if (invalid !== null) return { ok: false, reason: invalid }
    try {
      // 先解析目标文件名，再做安全备份：'latest' 取的是「恢复动作发生前」的
      // 最近一份——若先备份再解析，latest 会指向刚生成的安全副本（=当前状态）。
      const files = await remoteSnapshotNames(webdav)
      if (files.length === 0) return { ok: false, reason: '远端没有可用快照' }
      const name = target === 'latest' ? files[0]! : files.find((f) => f === target)
      if (name === undefined) return { ok: false, reason: `找不到快照 ${target}` }

      // 保险：先把当前便签推一份，失败即中止（避免覆盖后无备份）。
      const safety = await backupNow()
      if (!safety.ok) return { ok: false, reason: `恢复前自动备份失败：${safety.reason}` }

      const dir = normalizeDir(webdav.path)
      const res = await dav(webdav, 'GET', dir + name)
      if (!res.ok) throw new Error(`下载快照失败（HTTP ${res.status}）`)
      const raw = JSON.parse(await res.text()) as unknown
      const payload = validateBackupPayload(raw)
      const restoredNotes = payload.notes
      await options.replaceAll(restoredNotes)

      const meta = await metaGet()
      await metaPut({
        ...meta,
        lastRestoreAt: Date.now(),
        lastRestoreName: name,
        lastRestoreOk: true,
        watermark: maxUpdatedAt(restoredNotes),
      })
      return { ok: true, restored: restoredNotes.length, from: name }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const meta = await metaGet()
      await metaPut({ ...meta, lastRestoreAt: Date.now(), lastRestoreName: null, lastRestoreOk: false })
      return { ok: false, reason: message }
    }
  }

  /** 引擎状态快照（配置 enabled + meta 最近结果）。 */
  async function status(): Promise<WebdavStatus> {
    const webdav = await currentConfig()
    const meta = await metaGet()
    return {
      enabled: webdav?.enabled ?? false,
      lastBackupAt: meta.lastBackupAt,
      lastBackupOk: meta.lastBackupOk,
      lastBackupError: meta.lastBackupError,
      lastBackupName: meta.lastBackupName,
      lastRestoreAt: meta.lastRestoreAt,
      lastRestoreOk: meta.lastRestoreOk,
      lastRestoreName: meta.lastRestoreName,
    }
  }

  return { backupNow, listFiles, restore, status, checkAutomatic }
}

/** 兜底：过滤备份文件名（重新导出供外部需要时用，防误用原始列表）。 */
export { filterBackupFiles }