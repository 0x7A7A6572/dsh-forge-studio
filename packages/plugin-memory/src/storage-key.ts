/**
 * 存储键编码 —— memory 域落盘键的唯一生产者。
 *
 * 为什么必须有（实测故障）：storage-json 的 per-record 布局把键直接当文件路径的一段
 * （`<root>/<unit>/<table>/<key>.json`），只接受 `/^[a-zA-Z0-9_-]+$/`，不匹配时
 * `putRecord` / `deleteRecord` 直接抛错。而边记录的逻辑 id 是
 * `memory:<id>|about|entity:<id>`（`edgeIdOf` 的确定性 id）—— 带 `|` 与 `:`，
 * 于是 **每一次连边写入都失败**（memory_save 报
 * "per-record key ... is not path-safe"，连边、自动提及、related 全哑）。
 * 而单测的假表是纯 Map、从不校验键，所以整套用例全绿也照样全坏。
 *
 * 编码规则（`encodeKeyPart`）：
 * - `[a-z0-9-]` 原样保留；其余一律转义成 `_` + 4 位十六进制 UTF-16 码元。
 * - 只放行**小写**是有意为之：后端键是文件路径，Windows / macOS 默认大小写不敏感。
 * - 编码是单射（每字符要么原样 1 位、要么 `_hhhh` 5 位），且 `_` 只作转义引导，
 *   所以分片内部不可能出现 `__`，用 `__` 拼分片无歧义。
 *
 * 逻辑 id 与存储键**分离**：`edge.id` 仍是 `memory:…|about|entity:…`（client 契约、
 * 确定性去重的依据都不变），只在落盘那一刻经本模块转成路径安全键。
 */

/** per-record 后端的键规则（`@deepseek-ai/dsh-storage-json` 的 SAFE_KEY_RE）。 */
export const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/

/** 分片分隔符：`_` 只作转义引导（永远紧跟 4 位十六进制），故分片内部不可能出现 `__`。 */
const SEPARATOR = '__'
const ESCAPE_HEAD = '_'
const ESCAPE_WIDTH = 4
/** 整键为空串时的哨兵：不与任何真实编码撞键，又保证键非空且匹配 SAFE_KEY_RE。 */
const EMPTY_KEY = '_empty'

function escapeUnit(unit: number): string {
  return `${ESCAPE_HEAD}${unit.toString(16).padStart(ESCAPE_WIDTH, '0')}`
}

/** 单独一个字符是否可以原样落键（小写字母 / 数字 / 连字符）。 */
function isLiteralUnit(unit: number): boolean {
  return (unit >= 0x61 && unit <= 0x7a) || (unit >= 0x30 && unit <= 0x39) || unit === 0x2d
}

/** 单个分片 → 路径安全文本（单射）。 */
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

/** 解码整键（按 `__` 切分后逐片解码）。 */
export function decodeStorageKey(key: string): string[] {
  if (key === EMPTY_KEY) return ['']
  return key.split(SEPARATOR).map(decodeKeyPart)
}

/** 逻辑键（一个或多个分片）→ 存储键。新键一律走这里，不要在调用点拼分隔符。 */
export function storageKey(...parts: readonly (string | number)[]): string {
  const joined = parts.map((part) => encodeKeyPart(String(part))).join(SEPARATOR)
  return joined === '' ? EMPTY_KEY : joined
}

/**
 * 边记录的存储键：逻辑 id（`memory:<id>|about|entity:<id>`）→ 路径安全键。
 * 典型结果形如 `memory_003a<uuid>_007cabout_007centity_003a<uuid>`。
 */
export function edgeKey(edgeId: string): string {
  return storageKey(edgeId)
}
