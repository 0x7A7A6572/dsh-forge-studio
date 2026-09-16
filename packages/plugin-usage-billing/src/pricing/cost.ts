/**
 * 计价：TokenUsage 的四个互斥桶 × 单价四项。
 * 口径见 spec §5.2 —— inputTokens 不含缓存部分，所以 input / cacheRead / cacheWrite
 * 三者相加才是计费输入；reasoningTokens 已并入 output 计数，不单独计价。
 * 未命中任何价目时 priced=false 且 cost=0，由 UI 显著标注，绝不猜价。
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
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

/** 按 keys 顺序查价并计价。 */
export function priceUsage(
  usage: TokenUsage,
  table: Readonly<Record<string, PriceEntry>>,
  keys: readonly string[],
  usdToCny: number,
): PriceResult {
  for (let rank = 0; rank < keys.length; rank++) {
    const key = keys[rank]!
    const entry = table[key]
    if (entry === undefined) continue
    const s = splitUsage(usage)
    const native = (s.input * entry.input + s.cacheRead * entry.cacheRead
      + s.cacheWrite * entry.cacheWrite + s.output * entry.output) / 1_000_000
    const rate = usdToCny > 0 ? usdToCny : 0
    const costCny = entry.currency === 'USD' ? native * rate : native
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
