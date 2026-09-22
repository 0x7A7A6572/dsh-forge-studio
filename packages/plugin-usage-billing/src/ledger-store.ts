/**
 * LedgerStore —— 账本行的唯一读写通道，站在分片容器之上。
 *
 * 为什么必须有串行链：分片是「读整片 → 改 → 写整片」，而 domain 的 `put` 是「先落盘、
 * 再改内存、再发事件」，**读却始终是同步的**。两个并发写会各自读到同一份旧分片，
 * 后写把先写整片覆盖掉（丢行）。所以所有触碰分片的操作都排在同一条链上，
 * 链内每一步读到的都是上一步落盘后的状态。
 *
 * 为什么要有内存索引：聚合每轮都要按行 id 判重（`get(row.id)`），逐次扫分片表会把 O(1)
 * 变成 O(分片数)；索引在构造时一次性建立、之后随写入维护。行本身不复制，只存引用。
 *
 * 为什么写入要成批（`putMany`）：一片是一个记录，写一行就要整片重写。首次重建有 2 万行、
 * 每片几十行，逐行写等于把同一片反复重写几十遍（实测字节放大 22.8 倍）；按会话成批后
 * 一片一轮只写一次。
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { emptyShard, mergeShardRows, sameRow } from './shard-merge.ts'
import { ledgerShardKey } from './storage-key.ts'
import type { LedgerRow, LedgerShard } from './types.ts'

/**
 * 聚合侧对账本的**最小**需求。方法与原 `KvTable` 的同名成员同形，调用点不必改写法。
 */
export interface LedgerWriter {
  get(id: string): LedgerRow | undefined
  /** 成批写：同一分片的行合并成一次落盘，没变的行不写。 */
  putMany(rows: readonly LedgerRow[]): Promise<void>
}

/** 一批写入在某个分片上的增删，用来把「同一片的多行」缩成一次读写。 */
interface ShardPatch {
  sessionId: string
  day: string
  /** 要从这片摘掉的行 id（同一行换了天）。 */
  outgoing: Set<string>
  /** 要并入这片的行。 */
  incoming: Map<string, LedgerRow>
}

export class LedgerStore implements LedgerWriter {
  private readonly table: KvTable<string, LedgerShard>
  private readonly rowsById = new Map<string, LedgerRow>()
  /** 写链的尾；每个链接都自行吞掉 rejection，前一次失败不卡死后面的写入。 */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(table: KvTable<string, LedgerShard>) {
    this.table = table
    for (const [, shard] of table.entries()) {
      for (const row of shard.rows) this.rowsById.set(row.id, row)
    }
  }

  get size(): number { return this.rowsById.size }

  /** 分片记录数（诊断/验收用：这就是冷启动要打开的文件数）。 */
  get shardCount(): number { return this.table.size }

  get(id: string): LedgerRow | undefined { return this.rowsById.get(id) }

  /** 全量快照（视图层按窗口过滤，不在这里裁剪）。 */
  all(): LedgerRow[] { return [...this.rowsById.values()] }

  put(id: string, row: LedgerRow): Promise<void> { return this.putMany([row]) }

  putMany(rows: readonly LedgerRow[]): Promise<void> {
    if (rows.length === 0) return Promise.resolve()
    const run = this.chain.then(() => this.applyRows(rows))
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  /** 链内执行：把一批行落到它们各自的分片上，每片至多一次读写。 */
  private async applyRows(batch: readonly LedgerRow[]): Promise<void> {
    const patches = new Map<string, ShardPatch>()
    const patchAt = (key: string, sessionId: string, day: string): ShardPatch => {
      let patch = patches.get(key)
      if (patch === undefined) {
        patch = { sessionId, day, outgoing: new Set(), incoming: new Map() }
        patches.set(key, patch)
      }
      return patch
    }

    for (const row of batch) {
      const previous = this.rowsById.get(row.id)
      if (previous !== undefined) {
        const oldKey = ledgerShardKey(previous.sessionId, previous.day)
        const newKey = ledgerShardKey(row.sessionId, row.day)
        if (oldKey === newKey) {
          // 同片且内容未变：整片不写。正在写的会话每轮都会被重折，绝大多数行是旧行。
          if (sameRow(previous, row)) continue
        } else {
          // 换了分片（会话日志被改写导致 day 变了）：先从旧片摘掉，否则同一个 seq
          // 会在两片里各留一份，等于重复计费。
          patchAt(oldKey, previous.sessionId, previous.day).outgoing.add(row.id)
        }
      }
      const target = patchAt(ledgerShardKey(row.sessionId, row.day), row.sessionId, row.day)
      target.incoming.set(row.id, row)
    }

    for (const [key, patch] of patches) {
      const current = this.table.get(key)
      const kept = current === undefined
        ? []
        : current.rows.filter((candidate) => !patch.outgoing.has(candidate.id))
      const merged = mergeShardRows(kept, [...patch.incoming.values()])
      if (merged.rows.length === 0) {
        // 摘空即删键：不留空壳，否则每次冷启动都白读一个文件。
        if (current !== undefined) await this.table.delete(key)
      } else if (merged.changed || patch.outgoing.size > 0) {
        await this.table.put(key, emptyShard(patch.sessionId, patch.day, merged.rows))
      }
      for (const id of patch.outgoing) this.rowsById.delete(id)
      for (const row of patch.incoming.values()) this.rowsById.set(row.id, row)
    }
  }
}
