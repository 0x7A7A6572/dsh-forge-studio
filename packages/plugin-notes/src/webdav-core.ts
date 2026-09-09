/**
 * plugin-notes WebDAV 备份/恢复 —— 纯函数核心（无网络/无 ctx，便于单测）。
 *
 * 职责：备份 payload 的构建与校验、快照文件名、上传判定（watermark：有变更才
 * 传，省同步盘流量）、远端 PROPFIND 响应里的 href 提取、按保留份数挑选待删文件。
 * 网络请求、配置读取、meta 持久化与调度在 webdav-backup.ts（引擎）实现。
 */

import { DEFAULT_NOTE_COLOR, normalizeNoteColor } from './types.ts'
import type { NoteColor, NoteRecord } from './types.ts'

/** 备份文件 schema 标记。 */
export const WEBDAV_BACKUP_SCHEMA = 'notes-backup'
/** 备份文件格式版本（与恢复校验强绑定；改动须升版）。 */
export const WEBDAV_PAYLOAD_VERSION = 1
/** 快照文件名的固定前缀（含时间戳，可排序）。 */
const BACKUP_PREFIX = 'notes-'
const BACKUP_SUFFIX = '.json'
/** 文件名时间戳正则在整名中出现的形状：notes-YYYYMMDD-HHmmss.json */
const BACKUP_NAME_RE = /^notes-\d{8}-\d{6}(?:-\d+)?\.json$/u

export interface NotesBackupPayload {
  readonly schema: typeof WEBDAV_BACKUP_SCHEMA
  readonly version: typeof WEBDAV_PAYLOAD_VERSION
  readonly exportedAt: number
  readonly notes: readonly NoteRecord[]
}

/** 序列化备份 payload（含 schema 版本，供恢复侧校验）。 */
export function buildBackupPayload(
  notes: readonly NoteRecord[],
  exportedAt: number = Date.now(),
): NotesBackupPayload {
  return { schema: WEBDAV_BACKUP_SCHEMA, version: WEBDAV_PAYLOAD_VERSION, exportedAt, notes }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 快照文件名：notes-YYYYMMDD-HHmmss.json（按本机时区，固定宽度可排序）。 */
export function backupFileName(at: number = Date.now()): string {
  const d = new Date(at)
  return (
    BACKUP_PREFIX +
    d.getFullYear() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    '-' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds()) +
    BACKUP_SUFFIX
  )
}

/** 该文件名是否为本插件备份快照（时间戳形状匹配，含 -N 撞名后缀）。 */
export function isBackupFileName(name: string): boolean {
  return BACKUP_NAME_RE.test(name)
}

/**
 * 撞名去重：同一秒内多次备份（手动连点、恢复前安全备份紧跟列表）会生成相同
 * 时间戳名，PUT 会静默覆盖旧快照（丢数据）。对已存在集合中的名字追加 -N 后缀
 * 直到不冲突。
 */
export function uniqueBackupName(
  base: string,
  existing: ReadonlySet<string> | readonly string[],
): string {
  const set = existing instanceof Set ? existing : new Set(existing)
  if (!set.has(base)) return base
  let index = 2
  let candidate = base.replace(/\.json$/u, `-${index}.json`)
  while (set.has(candidate)) {
    index += 1
    candidate = base.replace(/\.json$/u, `-${index}.json`)
  }
  return candidate
}

/** 从远端文件列表过滤出本插件的备份快照。 */
export function filterBackupFiles(names: readonly string[]): string[] {
  return names.filter((name) => isBackupFileName(name))
}

/** 便签中最大的 updatedAt；无便签返回 0（用于 watermark 判断）。 */
export function maxUpdatedAt(notes: readonly NoteRecord[]): number {
  let max = 0
  for (const note of notes) {
    if (note.updatedAt > max) max = note.updatedAt
  }
  return max
}

/**
 * 是否需要上推：最新便签 updatedAt 高于已传水位才传（无便签或未变化跳过，
 * 省 WebDAV 流量）。watermark 为 null（从未传过）视作 0。
 */
export function shouldUpload(latest: number, watermark: number | null): boolean {
  return latest > (watermark ?? 0)
}

/**
 * 从 PROPFIND multistatus XML 提取 <href> 文本（带/不带命名空间前缀均可）。
 * 只做最轻量的实体解码（&amp; &lt; &gt; &quot; &#39;）。
 */
export function parseHrefs(xml: string): string[] {
  const hrefs: string[] = []
  const re = /<(?:[a-zA-Z0-9_]*:)?href\s*>([\s\S]*?)<\/(?:[a-zA-Z0-9_]*:)?href\s*>/giu
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    hrefs.push(
      match[1]!
        .trim()
        .replace(/&amp;/gu, '&')
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
        .replace(/&quot;/gu, '"')
        .replace(/&#39;/gu, "'"),
    )
  }
  return hrefs
}

/**
 * 快照排序键：时间戳段（YYYYMMDD-HHmmss）+ 同秒序号（无后缀 = 0，-N 后缀 = N）。
 * 同秒内后创建的快照（后缀更大）更新；文件名本身无后缀反而字典序更小，直接
 * 按字典序会把最早的当成最新（恢复/保留都会选错）。
 */
export function compareSnapshotNamesDesc(a: string, b: string): number {
  const ka = parseBackupSortKey(a)
  const kb = parseBackupSortKey(b)
  if (ka.ts !== kb.ts) return ka.ts < kb.ts ? 1 : -1
  return kb.seq - ka.seq
}

function parseBackupSortKey(name: string): { ts: string; seq: number } {
  const body = name.slice(BACKUP_PREFIX.length, name.length - BACKUP_SUFFIX.length)
  const ts = body.slice(0, 15)
  const rest = body.slice(15)
  const seq = rest === '' ? 0 : Number.parseInt(rest.replace(/^-/u, ''), 10) || 0
  return { ts, seq }
}

/**
 * 保留策略：按时间戳+同秒序号（降序）保留最近 keep 份，返回**应删除**的旧快照名。
 * 输入应为 filterBackupFiles 的产物（只含本插件快照）；不足 keep 份返回空。
 */
export function selectPruneNames(files: readonly string[], keep: number): string[] {
  const sorted = [...files].sort(compareSnapshotNamesDesc)
  if (sorted.length <= keep) return []
  return sorted.slice(keep)
}

const TASK_STATUSES = new Set(['backlog', 'todo', 'running', 'done', 'failed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 恢复前校验远端 payload：schema/版本/时间戳/便签数组形状（含颜色、任务状态
 * 等枚举越界拒绝）。通过后原样返回；失败抛 Error（人类可读）。
 */
export function validateBackupPayload(raw: unknown): NotesBackupPayload {
  if (!isRecord(raw)) throw new Error('备份文件不是 JSON 对象')
  if (raw.schema !== WEBDAV_BACKUP_SCHEMA) throw new Error('不是 plugin-notes 备份文件（schema 不符）')
  if (raw.version !== WEBDAV_PAYLOAD_VERSION) throw new Error(`备份版本不兼容（${String(raw.version)}，期望 ${WEBDAV_PAYLOAD_VERSION}）`)
  if (typeof raw.exportedAt !== 'number') throw new Error('备份文件缺导出时间')
  if (!Array.isArray(raw.notes)) throw new Error('备份文件缺 notes 数组')
  for (const entry of raw.notes) {
    if (!isRecord(entry)) throw new Error('备份内便签形状非法')
    if (typeof entry.id !== 'string' || entry.id.length === 0) throw new Error('备份内便签缺 id')
    if (typeof entry.title !== 'string') throw new Error('备份内便签缺 title')
    if (typeof entry.text !== 'string') throw new Error('备份内便签缺 text')
    if (typeof entry.pinned !== 'boolean') throw new Error('备份内便签 pinned 非法')
    if (typeof entry.archived !== 'boolean') throw new Error('备份内便签 archived 非法')
    if (normalizeNoteColor(entry.color) === undefined) throw new Error(`备份内便签颜色非法（${String(entry.color)}）`)
    if (entry.origin !== undefined && entry.origin !== 'user' && entry.origin !== 'agent') {
      throw new Error(`备份内便签 origin 非法（${String(entry.origin)}）`)
    }
    if (entry.lane !== undefined) {
      if (!isRecord(entry.lane) || typeof entry.lane.status !== 'string' || !TASK_STATUSES.has(entry.lane.status)) {
        throw new Error('备份内便签 lane 非法（缺状态/状态越界）')
      }
      if (entry.lane.run !== undefined) {
        const run = entry.lane.run
        if (!isRecord(run) || typeof run.startedAt !== 'number') throw new Error('备份内便签 run 帧非法')
        if (run.finishedAt !== undefined && typeof run.finishedAt !== 'number') throw new Error('备份内便签 run.finishedAt 非法')
        if (run.ok !== undefined && typeof run.ok !== 'boolean') throw new Error('备份内便签 run.ok 非法')
        if (run.summary !== undefined && typeof run.summary !== 'string') throw new Error('备份内便签 run.summary 非法')
      }
    }
    if (typeof entry.createdAt !== 'number' || typeof entry.updatedAt !== 'number') throw new Error('备份内便签时间戳非法')
  }
  return raw as unknown as NotesBackupPayload
}

/** 恢复时颜色兜底（对齐 domain 打开回填语义：非法/缺省 → 默认黄）。 */
export function restoreColor(value: unknown): NoteColor {
  return normalizeNoteColor(value) ?? DEFAULT_NOTE_COLOR
}