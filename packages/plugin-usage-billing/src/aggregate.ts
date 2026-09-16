/**
 * 聚合驱动：列会话 → 用水位（listEvents 的 max seq，只取元数据，便宜）判断是否要
 * 重折 → readSession 取正文 → foldEvents → 幂等 upsert 账本 → 写水位。
 *
 * 容错（spec §8）：单会话 readSession 抛错只跳过它、记诊断、**不推进水位**（下次重试），
 * 其余会话照常。诊断按 (sessionId, kind) 稳定键 upsert 并受上限约束，重试风暴不会涨存储。
 * 全量结果有 TTL 缓存以合并密集轮询。
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { recordDiagnostic, trimDiagnostics } from './diag.ts'
import { foldEvents } from './fold.ts'
import { resolveSnapshotAt } from './pricing/snapshot.ts'
import { foldKey } from './storage-key.ts'
import type { Diagnostic, FoldState, LedgerRow, ModelAlias, PriceSnapshot } from './types.ts'

export interface SessionSource {
  listSessions(): Promise<Array<{ header: SessionHeader }>>
  /** 只取元数据（`SessionEventRecord` 无 data），用于便宜地算最大 seq。 */
  listEvents(id: string): Promise<Array<{ seq: number }>>
  /**
   * 读取一个会话的**完整**事件序列。
   *
   * 必须包含 ≤ `maxSeq` 的全部 seq，不得截断、也不得挖空中间段：水位是
   * `maxSeq === foldedThroughSeq` 的等值比较，返回不完整会让未读事件**永久**不再折叠
   * （写时锁定意味着事后也无法补算）。分页/继承裁剪的实现必须把它们拼成完整序列再返回。
   */
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

/**
 * TTL 缓存（模块级：同一 host 内共享）。
 *
 * 选项语义（**别改成三态**）：`force` 为真只绕过这个 TTL 缓存，**水位始终生效** ——
 * 手动刷新仍然便宜，因为没新事件的会话连 `readSession` 都不会调。
 * 不重复计费由账本行 id `ledgerKey(sessionId, seq)`（`<sessionId>__<seq>`）的幂等 upsert
 * 保证，不靠水位。
 */
let lastRun: { at: number; stats: AggregateStats } | undefined

export function resetAggregateCache(): void { lastRun = undefined }

export async function aggregateOnce(
  deps: AggregateDeps,
  opts: { force?: boolean } = {},
): Promise<AggregateStats> {
  const now = deps.now ?? (() => Date.now())
  const ttl = deps.ttlMs ?? 5_000
  if (!opts.force && lastRun !== undefined && now() - lastRun.at < ttl) {
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
      const maxSeq = meta.reduce((m, e) => Math.max(m, e.seq), -1)
      const wm = deps.folds.get(foldKey(header.id))
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
      await deps.folds.put(foldKey(header.id), {
        sessionId: header.id,
        foldedThroughSeq: result.lastSeq,
        lastTime: result.lastTime,
        headerCreatedAt: header.createdAt,
        lastSnapshotId: resolveSnapshotAt(result.lastTime, snapshots).snapshotId,
      })
      for (const m of result.unpricedModels) unpriced.add(m)
      folded += 1
      rows += result.rows.length
    } catch (error) {
      failures += 1
      // 诊断写入本身还可能失败（storage 抖了），而它是唯一的副作用：让它自己兜住，
      // 否则一个坏会话会把其余会话一起带走。header 也可能缺失，先本地取值再拼内容。
      // 键稳定于 (sessionId, kind)：同一个坏会话重试多少次都只 upsert 同一条，
      // 不推进水位意味着它下轮还会被重试 —— 但重试只累加计数，不会再涨存储。
      const sessionId = header?.id ?? '<unknown>'
      try {
        await recordDiagnostic(deps.diag, {
          sessionId, kind: 'session-read', at: now(),
          detail: `${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        })
      } catch { /* 诊断写不进去也不能中断后续会话 */ }
    }
  }

  // 上限收口放在整轮末尾（而不是每条失败一次）：一轮最多多出「本轮坏会话数」条，
  // 结束后立刻回到上限之内 —— 重试风暴无法让 diag 表无界增长。清理失败不拖垮聚合。
  try {
    await trimDiagnostics(deps.diag)
  } catch { /* 诊断清理失败只是留下多余记录，不该让本轮聚合失败 */ }

  const stats: AggregateStats = {
    sessions: sessions.length, folded, skipped, rows, failures,
    unpricedModels: [...unpriced].sort(), cached: false,
  }
  lastRun = { at: now(), stats }
  return stats
}
