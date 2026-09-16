/**
 * 聚合驱动：列会话 → 用**变更戳**判断是否要重折 → readSession 取正文 → foldEvents →
 * 幂等 upsert 账本 → 写水位。
 *
 * 为什么不用 `sessionQuery.listEvents` 探水位（实测故障）：它名字像"只取元数据"，
 * 实现却是 `SessionCorpus.load` —— 每调一次都把整个语料再列一遍、再把那个会话完整
 * 解码并克隆全部事件，全程无缓存。107 个会话 = 一趟 107 次全量列举 + 107 次整会话解码，
 * 分钟级；而每个读接口都在等这一趟。变更戳由持久化后端在**一次 `list()`** 里给全
 * （stat 身份，不读正文），所以改用它。
 *
 * 容错（spec §8）：单会话 readSession 抛错只跳过它、记诊断、**不推进水位**（下次重试），
 * 其余会话照常。诊断按 (sessionId, kind) 稳定键 upsert 并受上限约束，重试风暴不会涨存储。
 * 全量结果有 TTL 缓存以合并密集轮询；同进程的并发调用由 service 侧合并成一趟。
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { recordDiagnostic, trimDiagnostics } from './diag.ts'
import { foldEvents } from './fold.ts'
import { resolveSnapshotAt } from './pricing/snapshot.ts'
import { foldKey } from './storage-key.ts'
import type { Diagnostic, FoldState, LedgerRow, ModelAlias, PriceSnapshot } from './types.ts'

export interface SessionSource {
  /**
   * 一次轻量列举：每个会话只给 header 与变更戳。**不得**为了拿戳而读会话正文。
   * `stamp === null` = 后端给不出变更戳，那一轮只能整会话重读（退化路径，慢但正确）。
   */
  listSessions(): Promise<Array<{ header: SessionHeader; stamp: string | null }>>
  /**
   * 读取一个会话的**完整**事件序列。
   *
   * 必须包含 ≤ `maxSeq` 的全部 seq，不得截断、也不得挖空中间段：返回不完整会让
   * 未读事件漏折。分页/继承裁剪的实现必须把它们拼成完整序列再返回。
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
 * 选项语义（**别改成三态**）：`force` 为真只绕过这个 TTL 缓存，**变更戳始终生效** ——
 * 手动刷新仍然便宜，因为没变过的会话连 `readSession` 都不会调。
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

  for (const { header, stamp } of sessions) {
    try {
      const wm = deps.folds.get(foldKey(header.id))
      // 戳相同 = 这份日志自上次折叠以来没变过；headerCreatedAt 只是 id 复用时的兜底。
      if (wm !== undefined && stamp !== null && wm.stamp === stamp && wm.headerCreatedAt === header.createdAt) {
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
      for (const row of result.rows) {
        // 只有内容真的变了才落盘：正在写的会话每轮都会被重折，但绝大多数行是上一轮的旧行，
        // 逐行无脑重写等于每轮白写几千个小文件。
        const previous = deps.ledger.get(row.id)
        if (previous !== undefined && unchangedRow(previous, row)) continue
        await deps.ledger.put(row.id, row)
      }
      await deps.folds.put(foldKey(header.id), {
        sessionId: header.id,
        // 戳为 null 时不写这个字段：下一轮继续整会话重读，等后端能给出戳为止。
        ...(stamp === null ? {} : { stamp }),
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

/** 逐字段比较两行账本（值都是原始类型，`!==` 即可；键集合不同即视为变了）。 */
function unchangedRow(a: LedgerRow, b: LedgerRow): boolean {
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) if (left[key] !== right[key]) return false
  return true
}
