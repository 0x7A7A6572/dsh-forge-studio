/**
 * 折叠：把一条会话的事件序列折成账本行（纯函数，不碰 storage、不做 IO）。
 *
 * 归属规则（spec §5.1）：request/context 的 {provider, model} 优先于
 * request/header 的 data.header.config；两者皆缺记 'unknown'，不丢账。
 * 计价规则（spec §5.3/§5.4）：**每条事件用它自己的 time 解析价表**，金额随即锁定。
 * 行 id = `ledgerKey(sessionId, seq)`（`<sessionId>__<seq>`，见 `storage-key.ts`），
 * 因此重复折叠是幂等 upsert。
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { aliasId, priceKeyCandidates } from './model-key.ts'
import { priceUsage } from './pricing/cost.ts'
import { isCnHoliday } from './pricing/holidays.ts'
import { tierAndFactorAt } from './pricing/tiers.ts'
import type { ResolvedTable } from './pricing/snapshot.ts'
import { ledgerKey } from './storage-key.ts'
import { dayKey } from './time.ts'
import type { LedgerRow, ModelAlias } from './types.ts'

export interface FoldContext {
  session: SessionHeader
  /** 首次装配时刻：早于它的事件标 backfilled。 */
  installAt: number
  aliases: ReadonlyMap<string, ModelAlias>
  resolvePrice: (at: number) => ResolvedTable
}

export interface FoldResult {
  rows: LedgerRow[]
  lastSeq: number
  lastTime: number
  /** 模型调用次数（含无 usage 与未计价的调用）。 */
  calls: number
  /** 未命中的 `${provider}/${model}`，供 UI 提示计数。 */
  unpricedModels: Set<string>
}

interface Attribution { provider: string; model: string }

const UNKNOWN: Attribution = { provider: 'unknown', model: 'unknown' }

export function foldEvents(events: readonly SessionEvent[], ctx: FoldContext): FoldResult {
  const rows: LedgerRow[] = []
  const unpricedModels = new Set<string>()
  let fromContext: Attribution | undefined
  let fromHeader: Attribution | undefined
  // 种子 -1：seq 0 的会话才有可用的空序列哨兵（0 会让它永远被水位跳过）。
  let lastSeq = -1
  let lastTime = 0
  let calls = 0

  for (const event of events) {
    if (event.seq > lastSeq) lastSeq = event.seq
    if (event.time > lastTime) lastTime = event.time

    if (event.type === 'request/context') {
      const d = event.data as { provider?: unknown; model?: unknown }
      if (typeof d.provider === 'string' && typeof d.model === 'string') {
        fromContext = { provider: d.provider, model: d.model }
      }
      continue
    }
    if (event.type === 'request/header') {
      const cfg = (event.data as { header?: { config?: { provider?: unknown; model?: unknown } } }).header?.config
      if (typeof cfg?.provider === 'string' && typeof cfg.model === 'string') {
        fromHeader = { provider: cfg.provider, model: cfg.model }
      }
      continue
    }
    if (event.type !== 'assistant/message') continue

    calls += 1
    const usage = (event.data as { usage?: import('@deepseek-ai/dsh-llm').TokenUsage }).usage
    if (usage === undefined) continue

    const who = fromContext ?? fromHeader ?? UNKNOWN
    const alias = ctx.aliases.get(aliasId(who.provider, who.model))
    const table = ctx.resolvePrice(event.time)
    const keys = priceKeyCandidates(who.provider, who.model, alias)
    const { tier, factor } = tierAndFactorAt(event.time, isCnHoliday)
    const priced = priceUsage(usage, table.entries, keys, table.usdToCny, factor)
    const modelLabel = `${who.provider}/${who.model}`
    if (!priced.priced) unpricedModels.add(modelLabel)

    rows.push({
      id: ledgerKey(ctx.session.id, event.seq),
      sessionId: ctx.session.id,
      seq: event.seq,
      time: event.time,
      provider: who.provider,
      model: who.model,
      day: dayKey(event.time),
      ...(ctx.session.cwd === undefined ? {} : { cwd: ctx.session.cwd }),
      isSubagent: ctx.session.origin === 'subagent',
      ...(ctx.session.delegationDepth === undefined ? {} : { delegationDepth: ctx.session.delegationDepth }),
      input: usage.inputTokens,
      cacheRead: usage.cacheReadTokens ?? 0,
      cacheWrite: usage.cacheWriteTokens ?? 0,
      output: usage.outputTokens,
      reasoning: usage.reasoningTokens ?? 0,
      costCny: priced.costCny,
      currency: priced.currency,
      priced: priced.priced,
      snapshotId: table.snapshotId,
      ...(tier === null ? {} : { tier }),
      backfilled: event.time < ctx.installAt,
    })
  }

  return { rows, lastSeq, lastTime, calls, unpricedModels }
}
