/**
 * 聚合驱动：列会话 → 用水位（listEvents 的 max seq，只取元数据，便宜）判断是否要
 * 重折 → readSession 取正文 → foldEvents → 幂等 upsert 账本 → 写水位。
 *
 * 容错（spec §8）：单会话 readSession 抛错只跳过它、记诊断、**不推进水位**（下次重试），
 * 其余会话照常。全量结果有 TTL 缓存以合并密集轮询。
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { foldEvents } from './fold.ts'
import { resolveSnapshotAt } from './pricing/snapshot.ts'
import type { Diagnostic, FoldState, LedgerRow, ModelAlias, PriceSnapshot } from './types.ts'

export interface SessionSource {
  listSessions(): Promise<Array<{ header: SessionHeader }>>
  /** 只取元数据（`SessionEventRecord` 无 data），用于便宜地算最大 seq。 */
  listEvents(id: string): Promise<Array<{ seq: number }>>
  readSession(id: string): Promise<{ session: SessionHeader; events: SessionEvent[] }>
}

export interface AggregateDeps {
  source: SessionSource
  ledger: KvTable<string, LedgerRow>
  folds: KvTable<string, FoldState>
  diag: KvTable<string, Diagnostic>
  aliases: KvTable<string, ModelAlias>
  snapshots: KvTable<string, PriceSnapshot>
  installAt: number
  now?: () => number
  ttlMs?: number
}

export interface AggregateStats {
  sessions: number
  folded: number
  skipped: number
  rows: number
  failures: number
  unpricedModels: string[]
  cached: boolean
}

/** TTL 缓存（模块级：同一 host 内共享，force 或超时才重算）。 */
let lastRun: { at: number; stats: AggregateStats } | undefined

export function resetAggregateCache(): void { lastRun = undefined }

export async function aggregateOnce(
  deps: AggregateDeps,
  opts: { force?: boolean } = {},
): Promise<AggregateStats> {
  const now = deps.now ?? (() => Date.now())
  const ttl = deps.ttlMs ?? 5_000
  // TTL 缓存只在**调用方未表达意图**（既没传 force 也没传 force:false）时生效。
  // 注意 `{ force: false }` 与「不传」语义不同：前者是「重新扫描，但允许水位跳过」，
  // 必须真正走下面的水位判断；否则水位永远不生效，一次缓存便长久盖住新事件。
  if (opts.force === undefined && lastRun !== undefined && now() - lastRun.at < ttl) {
    return { ...lastRun.stats, cached: true }
  }

  const snapshots = [...deps.snapshots.entries()].map(([, s]) => s)
  const aliasMap = new Map<string, ModelAlias>()
  for (const [, a] of deps.aliases.entries()) aliasMap.set(a.id, a)

  const sessions = await deps.source.listSessions()
  let folded = 0; let skipped = 0; let rows = 0; let failures = 0
  const unpriced = new Set<string>()

  for (const { header } of sessions) {
    try {
      const meta = await deps.source.listEvents(header.id)
      const maxSeq = meta.reduce((m, e) => Math.max(m, e.seq), 0)
      const wm = deps.folds.get(header.id)
      if (wm !== undefined && wm.foldedThroughSeq === maxSeq && wm.headerCreatedAt === header.createdAt) {
        skipped += 1
        continue
      }
      const snap = await deps.source.readSession(header.id)
      const result = foldEvents(snap.events, {
        session: snap.session,
        installAt: deps.installAt,
        aliases: aliasMap,
        resolvePrice: (at) => resolveSnapshotAt(at, snapshots),
      })
      for (const row of result.rows) await deps.ledger.put(row.id, row)
      await deps.folds.put(header.id, {
        sessionId: header.id,
        foldedThroughSeq: result.lastSeq,
        lastTime: result.lastTime,
        headerCreatedAt: header.createdAt,
        lastSnapshotId: snapshots.length > 0 ? snapshots[snapshots.length - 1]!.id : '',
      })
      for (const m of result.unpricedModels) unpriced.add(m)
      folded += 1
      rows += result.rows.length
    } catch (error) {
      failures += 1
      const id = `diag-${header.id}-${now()}`
      await deps.diag.put(id, {
        id, at: now(), kind: 'session-read',
        detail: `${header.id}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  const stats: AggregateStats = {
    sessions: sessions.length, folded, skipped, rows, failures,
    unpricedModels: [...unpriced].sort(), cached: false,
  }
  lastRun = { at: now(), stats }
  return stats
}
