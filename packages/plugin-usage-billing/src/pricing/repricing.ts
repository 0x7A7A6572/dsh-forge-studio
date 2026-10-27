/** 未计价行补价：价表取当前表，峰谷档位仍按事件时刻判。 */
import { aliasId, priceKeyCandidates } from '../model-key.ts'
import { priceUsage } from './cost.ts'
import type { ResolvedTable } from './snapshot.ts'
import { tierAndFactorAt } from './tiers.ts'
import type { LedgerRow, ModelAlias } from '../types.ts'

export function planRepricing(
  rows: readonly LedgerRow[],
  table: ResolvedTable,
  aliases: ReadonlyMap<string, ModelAlias>,
  isHoliday: (timeMs: number) => boolean,
): LedgerRow[] {
  const patched: LedgerRow[] = []
  for (const row of rows) {
    if (row.priced) continue
    const alias = aliases.get(aliasId(row.provider, row.model))
    // 档位属于事件本身，不能用补价时刻。
    const { tier, factor } = tierAndFactorAt(row.time, isHoliday)
    const result = priceUsage(
      { inputTokens: row.input, outputTokens: row.output, cacheReadTokens: row.cacheRead, cacheWriteTokens: row.cacheWrite },
      table.entries, priceKeyCandidates(row.provider, row.model, alias), table.usdToCny, factor,
    )
    if (!result.priced) continue
    patched.push({
      ...row,
      costCny: result.costCny,
      currency: result.currency,
      priced: true,
      snapshotId: table.snapshotId,
      ...(tier === null ? {} : { tier }),
    })
  }
  return patched
}
