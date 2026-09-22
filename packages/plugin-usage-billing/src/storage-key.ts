/**
 * 存储键编码 —— usage_billing **所有落盘键的唯一生产者**。
 *
 * 为什么必须集中（实测故障）：storage-json 的 per-record 布局把键直接当文件路径的一段
 * （`<root>/<unit>/<table>/<key>.json`），只接受 `/^[a-zA-Z0-9_-]+$/`，不匹配时
 * `putRecord` / `deleteRecord` 直接抛错。此前账本行 id 是 `${sessionId}#${seq}`、
 * 别名键用 NUL 分隔、delta 快照键是 `${prevId}#delta` —— 真实后端上**每一次写都失败**
 * （183 个会话反复失败、诊断表 50 分钟涨到 3014 条），而单测的假表从不校验键，
 * 303 个测试全绿也照样全坏。
 *
 * 编码规则（`encodeKeyPart`）：
 * - `[a-z0-9-]` 原样保留；其余一律转义成 `_` + 4 位十六进制 UTF-16 码元（`#` → `_0023`、
 *   下划线 → `_005f`、斜杠 / 点 / 空格 / NUL / 非 ASCII 同理）。
 * - 只放行**小写**是有意为之：后端键是文件路径，Windows / macOS 默认大小写不敏感，
 *   放行大写会让 `Claude-3` 与 `claude-3` 落到同一个文件上；转义后依然可逆。
 * - 因此典型的 `session-<uuid>`、`snap-install`、`custom-price` 原样不变（老数据继续命中），
 *   而任何用户可见的模型名 / provider / 别名都不会写出非法字符。
 *
 * 为什么不会撞键：
 * - 编码是单射（每个字符要么原样 1 位、要么 `_hhhh` 5 位，解码唯一），所以单个分片不会撞。
 * - `_` 在编码结果里**只作转义引导**，任何分片内部都不可能连续出现两个下划线，因此
 *   用 `__` 拼分片无歧义：`__` 永远不会是分片内容的一部分。多分片键于是也是单射
 *   （最后一段 `__` 之后必是最后一个分片）。
 * - 键只含 `[a-z0-9_-]`，永远满足 SAFE_KEY_RE，且没有 `.` / `..` / 斜杠可被当成路径。
 *
 * 没有任何代码解析存储键（账本行 id 只用于寻址，从不反解出 sessionId / seq）；
 * `decodeKeyPart` 只用于在测试里钉住可逆性与排障。
 */

import type { PriceSnapshot } from './types.ts'

/** per-record 后端的键规则（`@deepseek-ai/dsh-storage-json` 的 SAFE_KEY_RE）。 */
export const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/

/**
 * 分片分隔符：`_` 只作转义引导（永远紧跟 4 位十六进制），故分片内部不可能出现 `__`。
 * 除本模块外**不允许**再出现别的分隔符（旧代码里的 `#` 与 NUL 就是这么坏的）。
 */
const SEPARATOR = '__'

/** 转义引导：`_` + 4 位小写十六进制 UTF-16 码元。 */
const ESCAPE_HEAD = '_'
const ESCAPE_WIDTH = 4

/**
 * 整键为空串的哨兵（只有一个空分片时才会出现）。
 * 编码器永远不会产出它（`_` 在编码结果里必跟 4 位十六进制，`_empty` 解码会报错），
 * 所以它既不与任何真实编码撞键，又保证键永远非空、永远匹配 SAFE_KEY_RE。
 */
const EMPTY_KEY = '_empty'

function escapeUnit(unit: number): string {
  return `${ESCAPE_HEAD}${unit.toString(16).padStart(ESCAPE_WIDTH, '0')}`
}

/** 单独一个字符是否可以原样落键（小写字母 / 数字 / 连字符）。 */
function isLiteralUnit(unit: number): boolean {
  return (unit >= 0x61 && unit <= 0x7a) || (unit >= 0x30 && unit <= 0x39) || unit === 0x2d
}

/** 单个分片 → 路径安全文本（单射；见模块头注释）。 */
export function encodeKeyPart(part: string): string {
  let out = ''
  for (let i = 0; i < part.length; i += 1) {
    const unit = part.charCodeAt(i)
    out += isLiteralUnit(unit) ? part[i]! : escapeUnit(unit)
  }
  return out
}

/** `encodeKeyPart` 的逆运算。只用于测试与排障，生产代码不解析存储键。 */
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

/** 解码整键（按 `__` 切分后逐片解码；`EMPTY_KEY` 对应单个空分片）。 */
export function decodeStorageKey(key: string): string[] {
  if (key === EMPTY_KEY) return ['']
  return key.split(SEPARATOR).map(decodeKeyPart)
}

/**
 * 逻辑键（一个或多个分片）→ 存储键。数字分片按十进制字符串参与编码。
 * 新键一律走这里，不要在调用点拼分隔符。
 */
export function storageKey(...parts: readonly (string | number)[]): string {
  const joined = parts.map((part) => encodeKeyPart(String(part))).join(SEPARATOR)
  return joined === '' ? EMPTY_KEY : joined
}

/** 账本行键：`<sessionId>__<seq>`；同一事件重复折叠落到同一个键（幂等 upsert）。 */
export function ledgerKey(sessionId: string, seq: number): string {
  return storageKey(sessionId, seq)
}

/**
 * 账本分片键：`<sessionId>__<day>` —— 一个 (会话, 天) 的全部账本行放进同一条记录。
 *
 * 为什么要有这层容器：per-record 布局一行一文件，20,833 行 = 20,833 次文件打开，
 * 冷启动实测 35.7s（温 1.6s）；会话×天分片后 373 个文件实测 0.68s / 0.12s。
 * 为什么不把天并进行 id：行 id 是**数据身份**（`<sessionId>__<seq>`，已落在两万条记录里），
 * 改它就得动历史数据；分片键只是容器，换容器不动行。
 * `day` 是 'YYYY-MM-DD'，其中的 `-` 在编码规则里原样保留，键保持可读。
 */
export function ledgerShardKey(sessionId: string, day: string): string {
  return storageKey(sessionId, day)
}

/**
 * 折叠水位键：就是会话 id 的编码（单分片，不含分隔符）。
 * 典型的 `session-<uuid>`（小写十六进制）原样保留 —— 已落盘的水位记录键不变，不会丢水位重折。
 */
export function foldKey(sessionId: string): string {
  return storageKey(sessionId)
}

/** 手工别名键（provider 已归一化、rawModel 已 trim；**不要**在这里再拼 NUL）。 */
export function aliasKey(provider: string, rawModel: string): string {
  return storageKey(provider, rawModel)
}

/**
 * 诊断键：**稳定**于 (sessionId, kind)。
 * 同一个坏会话反复失败只会 upsert 到同一条（累加 count / 刷新 lastAt），
 * 不再像旧实现那样每次失败都 mint 一个带 `now()` 的新键、把存储写爆。
 */
export function diagKey(sessionId: string, kind: string): string {
  return storageKey('diag', sessionId, kind)
}

/**
 * 安装基准 / 首条 base 快照 id：历史字面量（已经落在用户数据里），
 * 且本身即 `encodeKeyPart` 的不动点（全小写 + 连字符），保持不变。
 */
export const SNAPSHOT_INSTALL_ID = 'snap-install'
export const SNAPSHOT_BASE_ID = 'snap-base'

/**
 * 价表 delta 快照键：由 (reason, at) 决定，同毫秒冲突时用 ordinal 区分。
 *
 * 刻意**不**沿用 `上一份 id + 后缀` 的链式构造：链式键长随 delta 条数线性增长
 * （旧键每追加一条 +6 字符），迟早撑爆文件系统单段 255 字符的上限；这里键长恒定。
 * 快照的先后仍由 `at`（+ id 次序）决定，与键长无关。
 */
export function snapshotDeltaKey(
  reason: PriceSnapshot['reason'],
  at: number,
  ordinal = 1,
): string {
  return ordinal <= 1 ? storageKey('snap', reason, at) : storageKey('snap', reason, at, ordinal)
}

/**
 * 在已有键集合里挑一个未占用的 delta 键：同一毫秒内的两次写入必须拿到不同的键
 * （撞键会让后一次 put 悄悄盖掉前一次改价 —— 唯一价态就丢了）。
 */
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
