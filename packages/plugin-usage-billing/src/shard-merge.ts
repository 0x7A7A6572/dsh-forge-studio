/**
 * 分片合并 —— 幂等内核（纯函数，不碰 storage、不做 IO）。
 *
 * 为什么单独成文件：行身份从「存储键唯一」搬到「分片内 id 唯一」之后，幂等就从存储层
 * 保证变成这里的不变量；它必须能脱离 storage 单测（历史上正是「假表从不校验键」
 * 让一次全量写失败瞒过了全部用例）。
 */

import type { LedgerRow, LedgerShard } from './types.ts'

/** 分片记录的当前格式版本。 */
export const SHARD_VERSION = 1

export interface ShardMerge {
  rows: LedgerRow[]
  /** 批次有没有真的改动；false 时调用方必须跳过整片重写。 */
  changed: boolean
}

export function emptyShard(sessionId: string, day: string, rows: LedgerRow[] = []): LedgerShard {
  return { v: SHARD_VERSION, sessionId, day, rows }
}

/** 逐字段比较两行账本（值都是原始类型，`!==` 即可；键集合不同即视为变了）。 */
export function sameRow(a: LedgerRow, b: LedgerRow): boolean {
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) if (left[key] !== right[key]) return false
  return true
}

/**
 * 把一批行并入分片：身份是 `row.id`（= `<sessionId>__<seq>`），后写覆盖，按 seq 升序归一。
 *
 * 三条不变量（测试钉住）：同批重复并入 → `changed: false` 且内容不变（幂等）；同 id 再次
 * 并入 → 覆盖而不是追加；批内顺序不影响结果（字节稳定，落盘文件可直接比对）。
 */
export function mergeShardRows(current: readonly LedgerRow[], batch: readonly LedgerRow[]): ShardMerge {
  const byId = new Map<string, LedgerRow>()
  for (const row of current) byId.set(row.id, row)
  let changed = false
  for (const row of batch) {
    const previous = byId.get(row.id)
    if (previous !== undefined && sameRow(previous, row)) continue
    byId.set(row.id, row)
    changed = true
  }
  // 未变时原样返回：调用方据此整片跳过 put，不必先写再比。
  if (!changed) return { rows: current as LedgerRow[], changed: false }
  const rows = [...byId.values()].sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { rows, changed: true }
}
