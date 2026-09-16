/**
 * 价表快照账本：一条 base 全量 + 后续 delta 差量，**只追加不修改**。
 * 折叠某条事件时用 resolveSnapshotAt(事件 time) 拿到「当时生效的价表」，
 * 金额随即锁定 —— 这是 spec §5.3 的实现。
 */

import type { PriceEntry, PriceSnapshot } from '../types.ts'

export interface SnapshotInput {
  entries: Record<string, PriceEntry>
  usdToCny: number
  usdToCnySource: 'live' | 'default'
}

export interface ResolvedTable extends SnapshotInput {
  snapshotId: string
}

function sameEntry(a: PriceEntry, b: PriceEntry): boolean {
  return a.input === b.input && a.cacheRead === b.cacheRead
    && a.cacheWrite === b.cacheWrite && a.output === b.output && a.currency === b.currency
}

/** 相对上一份价表的差异：新增/变更条目 + 被删除的 key。 */
export function diffEntries(
  prev: Readonly<Record<string, PriceEntry>>,
  next: Readonly<Record<string, PriceEntry>>,
): { entries: Record<string, PriceEntry>; removed: string[] } {
  const entries: Record<string, PriceEntry> = {}
  for (const [k, v] of Object.entries(next)) {
    const before = prev[k]
    if (before === undefined || !sameEntry(before, v)) entries[k] = v
  }
  const removed = Object.keys(prev).filter((k) => next[k] === undefined)
  return { entries, removed }
}

/**
 * 计划下一次快照：prev 不存在 → base；有实质变化（含汇率变化）→ delta；
 * 否则返回 null（不追加空 delta，避免账本膨胀）。
 */
export function planSnapshot(
  prev: PriceSnapshot | undefined,
  next: SnapshotInput,
  meta: { id: string; at: number; reason: PriceSnapshot['reason'] },
): PriceSnapshot | null {
  if (prev === undefined) {
    return {
      id: meta.id, at: meta.at, kind: 'base', reason: meta.reason,
      usdToCny: next.usdToCny, usdToCnySource: next.usdToCnySource,
      entries: { ...next.entries },
    }
  }
  const d = diffEntries(prev.entries, next.entries)
  const changed = Object.keys(d.entries).length > 0 || d.removed.length > 0
  const rateChanged = prev.usdToCny !== next.usdToCny || prev.usdToCnySource !== next.usdToCnySource
  if (!changed && !rateChanged) return null
  return {
    id: meta.id, at: meta.at, kind: 'delta', reason: meta.reason,
    usdToCny: next.usdToCny, usdToCnySource: next.usdToCnySource,
    entries: d.entries,
    ...(d.removed.length > 0 ? { removed: d.removed } : {}),
  }
}

/**
 * 解析时刻 `at` 生效的价表。t 早于首快照时用首快照（安装前历史的回填口径）。
 * 纯函数：先按 at 升序复制一份再累加，输入数组与快照对象都不被改动。
 */
export function resolveSnapshotAt(at: number, all: readonly PriceSnapshot[]): ResolvedTable {
  const ordered = [...all].sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id))
  const first = ordered[0]
  if (first === undefined) {
    return { entries: {}, usdToCny: 0, usdToCnySource: 'default', snapshotId: '' }
  }
  let entries: Record<string, PriceEntry> = {}
  let usdToCny = first.usdToCny
  let usdToCnySource = first.usdToCnySource
  let snapshotId = first.id
  if (first.kind === 'base') entries = { ...first.entries }
  for (const snap of ordered) {
    if (snap.at > at) break
    if (snap.kind === 'base') entries = { ...snap.entries }
    else {
      for (const [k, v] of Object.entries(snap.entries)) entries[k] = v
      for (const k of snap.removed ?? []) delete entries[k]
    }
    usdToCny = snap.usdToCny
    usdToCnySource = snap.usdToCnySource
    snapshotId = snap.id
  }
  return { entries, usdToCny, usdToCnySource, snapshotId }
}
