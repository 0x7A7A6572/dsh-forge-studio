/**
 * 计价：TokenUsage 的四个互斥桶 × 单价四项。
 * 口径见 spec §5.2 —— inputTokens 不含缓存部分，所以 input / cacheRead / cacheWrite
 * 三者相加才是计费输入；reasoningTokens 已并入 output 计数，不单独计价。
 * 未命中任何价目时 priced=false 且 cost=0，由 UI 显著标注，绝不猜价。
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { WILDCARD, normalizeModelId } from '../model-key.ts'
import type { Currency, PriceEntry } from '../types.ts'

export interface SplitUsage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reason: number | undefined
}

export interface PriceResult {
  costCny: number
  currency: Currency
  priced: boolean
  matchedKey: string | null
  /** 命中 keys 中的第几档（0 起）；未命中为 -1。 */
  matchRank: number
}

/** 拆四桶（缺失的缓存字段按 0）。 */
export function splitUsage(usage: TokenUsage): SplitUsage {
  return {
    input: usage.inputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    output: usage.outputTokens,
    reason: usage.reasoningTokens,
  }
}

/** 同名兜底候选的前缀：首段 `*` + 斜杠 + 模型名 = 「任何 provider 下叫这个名字的价」。 */
const NAME_FALLBACK_PREFIX = `${WILDCARD}/`

/**
 * 表内「模型名 → 命中键」索引（延迟构建，按表的键**插入顺序**取第一条）。
 *
 * 插入顺序即优先级来源：内置目录在安装时就写进基准快照，网络刷新只会往后追加 delta，
 * 所以同一个模型名有多个 provider 时先出现的（目录里的官方 provider）胜出 —— 确定性、可解释。
 *
 * 用 WeakMap 挂在价目表本身上：快照表是不可变对象，按表缓存不会串味，也不会泄漏。
 */
const nameIndexCache = new WeakMap<object, Map<string, string>>()

/** 表内同名条目键；没有则 undefined。 */
function sameNameEntryKey(table: Readonly<Record<string, PriceEntry>>, name: string): string | undefined {
  let index = nameIndexCache.get(table)
  if (index === undefined) {
    index = new Map<string, string>()
    for (const key of Object.keys(table)) {
      const slash = key.indexOf('/')
      if (slash <= 0) continue
      const modelPart = key.slice(slash + 1)
      // `<provider>/*` 与 `*/*` 是兜底价，不是「某个模型的同名价」。
      if (modelPart === WILDCARD) continue
      const normalized = normalizeModelId(modelPart)
      if (normalized !== '' && !index.has(normalized)) index.set(normalized, key)
    }
    nameIndexCache.set(table, index)
  }
  return index.get(normalizeModelId(name))
}

/**
 * 解析一个候选键：先按字面命中；首段为 `*` 的候选再走同名兜底。
 * @param table - 该时刻解析出的价目表（`<provider>/<model>` → 单价）。
 * @param key - 候选键，见 `priceKeyCandidates`。
 */
function entryFor(table: Readonly<Record<string, PriceEntry>>, key: string): PriceEntry | undefined {
  const direct = table[key]
  if (direct !== undefined) return direct
  if (!key.startsWith(NAME_FALLBACK_PREFIX)) return undefined
  const hit = sameNameEntryKey(table, key.slice(NAME_FALLBACK_PREFIX.length))
  return hit === undefined ? undefined : table[hit]
}

/** 按 keys 顺序查价并计价（首段为 `*` 的候选 = 同名兜底，见 `priceKeyCandidates`）。 */
export function priceUsage(
  usage: TokenUsage,
  table: Readonly<Record<string, PriceEntry>>,
  keys: readonly string[],
  usdToCny: number,
): PriceResult {
  for (let rank = 0; rank < keys.length; rank++) {
    const key = keys[rank]!
    const entry = entryFor(table, key)
    if (entry === undefined) continue
    if (entry.currency === 'USD' && !(usdToCny > 0)) {
      // 汇率不可用：宁可标成「不可计价」也不锁一个 0 进账本。
      // matchedKey 非 null 是它与「未收录」（matchedKey === null）的区别。
      return { costCny: 0, currency: entry.currency, priced: false, matchedKey: key, matchRank: rank }
    }
    const s = splitUsage(usage)
    const native = (s.input * entry.input + s.cacheRead * entry.cacheRead
      + s.cacheWrite * entry.cacheWrite + s.output * entry.output) / 1_000_000
    const costCny = entry.currency === 'USD' ? native * usdToCny : native
    return {
      costCny: Math.max(0, costCny),
      currency: entry.currency,
      priced: true,
      matchedKey: key,
      matchRank: rank,
    }
  }
  return { costCny: 0, currency: 'CNY', priced: false, matchedKey: null, matchRank: -1 }
}
