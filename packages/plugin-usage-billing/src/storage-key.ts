/**
 * usage_billing 所有落盘键的唯一生产者。键就是文件路径的一段，只接受
 * `/^[a-zA-Z0-9_-]+$/`；编码单射，`[a-z0-9-]` 原样保留，其余转义成 `_` + 4 位十六进制码元。
 * 只放行小写是有意的：Windows / macOS 大小写不敏感，大写会让 `Claude-3` 与 `claude-3` 同文件。
 */

import type { PriceSnapshot } from './types.ts'

/** 与 `@deepseek-ai/dsh-storage-json` 的 SAFE_KEY_RE 一致。 */
export const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/

/** 分片分隔符。`_` 只作转义引导，故分片内不可能出现 `__`。 */
const SEPARATOR = '__'

/** 转义引导：`_` + 4 位十六进制 UTF-16 码元。 */
const ESCAPE_HEAD = '_'
const ESCAPE_WIDTH = 4

/** 整键为空串的哨兵：编码器永远产不出它，又保证键非空。 */
const EMPTY_KEY = '_empty'

function escapeUnit(unit: number): string {
  return `${ESCAPE_HEAD}${unit.toString(16).padStart(ESCAPE_WIDTH, '0')}`
}

function isLiteralUnit(unit: number): boolean {
  return (unit >= 0x61 && unit <= 0x7a) || (unit >= 0x30 && unit <= 0x39) || unit === 0x2d
}

/** 单射，见模块头。 */
export function encodeKeyPart(part: string): string {
  let out = ''
  for (let i = 0; i < part.length; i += 1) {
    const unit = part.charCodeAt(i)
    out += isLiteralUnit(unit) ? part[i]! : escapeUnit(unit)
  }
  return out
}

/** 逆运算。只用于测试与排障，生产代码不解析存储键。 */
export function decodeKeyPart(encoded: string): string {
  let out = ''
  let i = 0
  while (i < encoded.length) {
    if (encoded[i] !== ESCAPE_HEAD) {
      out += encoded[i]!
      i += 1
      continue
    }
    const digits = encoded.slice(i + 1, i + 1 + ESCAPE_WIDTH)
    if (digits.length !== ESCAPE_WIDTH || !/^[0-9a-f]{4}$/.test(digits)) {
      throw new Error(`decodeKeyPart: '${encoded}' 不是本模块产出的编码`)
    }
    out += String.fromCharCode(Number.parseInt(digits, 16))
    i += 1 + ESCAPE_WIDTH
  }
  return out
}

export function decodeStorageKey(key: string): string[] {
  if (key === EMPTY_KEY) return ['']
  return key.split(SEPARATOR).map(decodeKeyPart)
}

/** 新键一律走这里，不要在调用点拼分隔符。 */
export function storageKey(...parts: readonly (string | number)[]): string {
  const joined = parts.map((part) => encodeKeyPart(String(part))).join(SEPARATOR)
  return joined === '' ? EMPTY_KEY : joined
}

/** 同一事件重复折叠落到同一个键（幂等 upsert）。 */
export function ledgerKey(sessionId: string, seq: number): string {
  return storageKey(sessionId, seq)
}

/**
 * 账本分片键：一个 (会话, 天) 的全部账本行放进同一条记录。
 * 行 id 是数据身份不能改，分片键只是容器。
 */
export function ledgerShardKey(sessionId: string, day: string): string {
  return storageKey(sessionId, day)
}

/** 折叠水位键就是会话 id 的编码；老键不变，不会丢水位重折。 */
export function foldKey(sessionId: string): string {
  return storageKey(sessionId)
}

/** provider 已归一化、rawModel 已 trim；不要在这里再拼 NUL。 */
export function aliasKey(provider: string, rawModel: string): string {
  return storageKey(provider, rawModel)
}

/** 稳定于 (sessionId, kind)：同一坏会话反复失败只 upsert 同一条。 */
export function diagKey(sessionId: string, kind: string): string {
  return storageKey('diag', sessionId, kind)
}

/** 历史字面量，已落在用户数据里；也是 `encodeKeyPart` 的不动点。 */
export const SNAPSHOT_INSTALL_ID = 'snap-install'
export const SNAPSHOT_BASE_ID = 'snap-base'

/**
 * 键长恒定，不沿用「上一份 id + 后缀」的链式构造：链式键长随 delta 条数线性增长，
 * 迟早撑爆文件系统单段 255 字符的上限。
 */
export function snapshotDeltaKey(
  reason: PriceSnapshot['reason'],
  at: number,
  ordinal = 1,
): string {
  return ordinal <= 1 ? storageKey('snap', reason, at) : storageKey('snap', reason, at, ordinal)
}

/** 同一毫秒的两次写入必须拿到不同的键，撞键会丢掉前一次改价。 */
export function uniqueSnapshotDeltaKey(
  existing: ReadonlySet<string>,
  reason: PriceSnapshot['reason'],
  at: number,
): string {
  let ordinal = 1
  let key = snapshotDeltaKey(reason, at, ordinal)
  while (existing.has(key)) {
    ordinal += 1
    key = snapshotDeltaKey(reason, at, ordinal)
  }
  return key
}
