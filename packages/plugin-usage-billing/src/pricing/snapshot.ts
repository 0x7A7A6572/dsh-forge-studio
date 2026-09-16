/**
 * 价表快照账本：一条 base 全量 + 后续 delta 差量，**只追加不修改**。
 * 折叠某条事件时用 resolveSnapshotAt(事件 time) 拿到「当时生效的价表」，
 * 金额随即锁定 —— 这是 spec §5.3 的实现。
 */

import type { PriceEntry, PriceSnapshot } from '../types.ts'

/** 「目录层」的三类快照：内置目录（install）与两次刷新写入的都是目录价，不是覆盖价。 */
export const CATALOG_REASONS = ['install', 'catalog-refresh', 'manual-refresh'] as const

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
 *
 * `prev` 是「此刻之前生效的完整状态」，由调用方用 `resolveSnapshotAt` 取到；
 * **绝不是上一条快照记录** —— delta 只含差量，拿它当基线会漏掉「目录删掉了某个模型」，
 * 且每份 delta 都会退化成接近全量的 diff。
 */
export function planSnapshot(
  prev: SnapshotInput | undefined,
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
 *
 * `reasons` 限定只重放哪些来源的记录（缺省 = 全部，即累计价表口径）；
 * 传入 `CATALOG_REASONS` 得到的就是「目录层今日取值」，覆盖价不参与。
 */
export function resolveLayerAt(
  at: number,
  all: readonly PriceSnapshot[],
  reasons?: readonly PriceSnapshot['reason'][],
): ResolvedTable {
  const ordered = [...all]
    .filter((s) => reasons === undefined || reasons.includes(s.reason))
    .sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id))
  const first = ordered[0]
  if (first === undefined) {
    return { entries: {}, usdToCny: 0, usdToCnySource: 'default', snapshotId: '' }
  }
  let entries: Record<string, PriceEntry> = {}
  let usdToCny = first.usdToCny
  let usdToCnySource = first.usdToCnySource
  // at 早于首快照 → 回填口径：整体采用首快照，entries / 汇率 / id 三者必须一致。
  const backfill = at < first.at
  if (backfill) {
    for (const [k, v] of Object.entries(first.entries)) entries[k] = { ...v }
  }
  let snapshotId = backfill ? first.id : ''
  for (const snap of ordered) {
    if (snap.at > at) break
    if (snap.kind === 'base') {
      entries = {}
      for (const [k, v] of Object.entries(snap.entries)) entries[k] = { ...v }
    } else {
      for (const [k, v] of Object.entries(snap.entries)) entries[k] = { ...v }
      for (const k of snap.removed ?? []) delete entries[k]
    }
    usdToCny = snap.usdToCny
    usdToCnySource = snap.usdToCnySource
    snapshotId = snap.id
  }
  return { entries, usdToCny, usdToCnySource, snapshotId }
}

/** 目前仍然生效的自定义价：重放自定义记录，丢掉「写回的就是当时目录价」的那些（即已取消的）。 */
export function activeOverridesAt(at: number, all: readonly PriceSnapshot[]): Record<string, PriceEntry> {
  const active: Record<string, PriceEntry> = {}
  const ordered = [...all].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  for (const snap of ordered) {
    if (snap.at > at) break
    if (snap.reason !== 'custom-price') continue
    const catalogThen = resolveLayerAt(snap.at, all, CATALOG_REASONS).entries
    for (const [k, v] of Object.entries(snap.entries)) {
      const cat = catalogThen[k]
      // 取消自定义价时写回的正是「当时的目录价」→ 该 key 已无自定义价。
      // 用 sameEntry 而不是手抄五个字段：PriceEntry 将来多一个字段时，取消判定不会静默失效。
      if (cat !== undefined && sameEntry(cat, v)) {
        delete active[k]
        continue
      }
      active[k] = { ...v }
    }
    for (const k of snap.removed ?? []) delete active[k]
  }
  return active
}

/** 全量重放（不按来源过滤）——累计价表口径。 */
export function resolveSnapshotAt(at: number, all: readonly PriceSnapshot[]): ResolvedTable {
  return resolveLayerAt(at, all)
}
