/**
 * 诊断读写：诊断键**稳定**于 (sessionId, kind)，写入是 upsert 合并，不是追加。
 *
 * 为什么（实测故障）：旧实现每次会话读取失败都 `put('diag-<sessionId>-<now()>', …)` ——
 * `now()` 在键里意味着每次重试都是**新键**，用户家里 50 分钟涨到 3014 条、
 * `status()` 每次调用还要全表排序。稳定键 + 上限共同保证「重试风暴不会无界增长」。
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { diagKey } from './storage-key.ts'
import type { Diagnostic } from './types.ts'

/**
 * diag 表保留条数上限。取 50：远大于「同时坏掉的会话数」的典型量级，
 * 又小到 `status()` 的单遍扫描可以忽略不计。
 */
export const MAX_DIAGNOSTICS = 50

/** 一条记录「最近被看见」的时刻；旧记录（稳定键之前落盘的）没有 lastAt，按 at 处理。 */
export function seenAt(diag: Diagnostic): number {
  return diag.lastAt !== undefined && diag.lastAt > 0 ? diag.lastAt : diag.at
}

export interface DiagnosticInput {
  sessionId: string
  kind: Diagnostic['kind']
  detail: string
  at: number
}

/**
 * 按 (sessionId, kind) 稳定键 upsert：同一故障反复出现只累加 `count`、刷新 `lastAt` 与 `detail`，
 * 键不变、条数不增。`at` 保留首次出现的时刻。
 */
export async function recordDiagnostic(
  table: KvTable<string, Diagnostic>,
  input: DiagnosticInput,
): Promise<void> {
  const id = diagKey(input.sessionId, input.kind)
  const prev = table.get(id)
  await table.put(id, {
    id,
    kind: input.kind,
    detail: input.detail,
    at: prev?.at ?? input.at,
    lastAt: input.at,
    // 老记录（稳定键之前落盘）没有 count：它代表「至少出现过一次」，按 1 起算。
    count: prev === undefined ? 1 : (prev.count ?? 1) + 1,
  })
}

/**
 * 只保留最近 `max` 条（按「最近被看见」排序），多出来的从旧到新删除。
 * @returns 实际删掉的条数。
 */
export async function trimDiagnostics(
  table: KvTable<string, Diagnostic>,
  max = MAX_DIAGNOSTICS,
): Promise<number> {
  const entries = [...table.entries()]
  const excess = entries.length - max
  if (excess <= 0) return 0
  const doomed = entries
    .map(([key, diag]) => ({ key, seen: seenAt(diag) }))
    .sort((a, b) => a.seen - b.seen || a.key.localeCompare(b.key))
    .slice(0, excess)
  for (const { key } of doomed) await table.delete(key)
  return doomed.length
}

/** 最新一条诊断（单遍 O(n)，不再像旧 `status()` 那样每次全表排序）。 */
export function latestDiagnostic(table: KvTable<string, Diagnostic>): Diagnostic | undefined {
  let latest: Diagnostic | undefined
  for (const [, diag] of table.entries()) {
    if (latest === undefined || seenAt(diag) > seenAt(latest)) latest = diag
  }
  return latest
}
