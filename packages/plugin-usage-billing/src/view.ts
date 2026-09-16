/**
 * 展示视图：把账本行按各维度聚成 UI 直接可用的形状。
 *
 * **别名只在这里生效**（spec §5.5）：账本永远是原始 id，金额已锁定；合并 = token 与
 * 金额直接相加。合并**只在同一 provider 内**，不跨 provider。
 * 所有函数都是纯函数，缓存由 service 层的 LRU 负责。
 */

import { aliasId } from './model-key.ts'
import { priceKey } from './pricing/catalog.ts'
import type { LedgerRow, ModelAlias } from './types.ts'

export interface ModelRow {
  key: string
  provider: string
  model: string
  rawModels: string[]
  input: number; cacheRead: number; cacheWrite: number; output: number; reasoning: number
  costCny: number
  /** 合并行上 `priced: false` 表示**至少一行**未计价；该行仍可能带着已计价行累加出的非零 `costCny`。 */
  priced: boolean
  /**
   * 比较的是**混合后的每 token 成本比** `costCny / (input + cacheRead + cacheWrite + output)`，不是单价：
   * 价格表不变而 token 结构不同也会置位；两种不同价格若比值四舍五入后相同则不置位。
   */
  mixedRate: boolean
  calls: number
}

export interface DailyPoint {
  day: string; costCny: number
  input: number; cacheRead: number; cacheWrite: number; output: number; calls: number
}

export interface SessionRow {
  sessionId: string; cwd?: string; day: string; calls: number
  costCny: number; lastTime: number; isSubagent: boolean
}

export interface WorkspaceRow { cwd: string; calls: number; costCny: number; sessions: SessionRow[] }

export interface Overview {
  totalCny: number; todayCny: number; weekCny: number; avgDailyCny: number
  /**
   * 缓存命中率 = cacheRead / (input + cacheRead)。
   * 分母含未计价行（它们同样携带真实观测 token，剔除会让该比值与旁边的 token 合计口径打架）；
   * 分母**不含 cacheWrite**（缓存写入不是「读取命中」的分母）。空分母时为 0。
   */
  cacheHitRate: number
  calls: number
  /**
   * 未计价模型：刻意使用**账本原始** `provider/model` id —— `buildOverview` 拿不到别名表，
   * 且原始 id 正是用户需要去补价格的那个名字。
   */
  unpricedModels: string[]
  unpricedRows: number; hasBackfilled: boolean
}

export const UNKNOWN_WORKSPACE = '未知工作区'

function emptyModel(key: string, provider: string, model: string): ModelRow {
  return {
    key, provider, model, rawModels: [],
    input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0,
    costCny: 0, priced: true, mixedRate: false, calls: 0,
  }
}

/** 按 (provider, 别名 canonical) 合并；同 provider 内才合并。 */
export function mergeByModel(rows: readonly LedgerRow[], aliases: readonly ModelAlias[]): ModelRow[] {
  const canon = new Map<string, string>()
  for (const a of aliases) canon.set(a.id, a.canonicalModel)
  const byKey = new Map<string, { row: ModelRow; rates: Set<number> }>()

  for (const r of rows) {
    const provider = r.provider.trim().toLowerCase()
    // 空 canonical 不是有效的合并目标：否则所有带该别名的模型会被并成一行。
    const canonical = canon.get(aliasId(provider, r.model)) || r.model
    const key = priceKey(provider, canonical)
    let slot = byKey.get(key)
    if (slot === undefined) {
      slot = { row: emptyModel(key, provider, canonical), rates: new Set() }
      byKey.set(key, slot)
    }
    const m = slot.row
    m.input += r.input; m.cacheRead += r.cacheRead; m.cacheWrite += r.cacheWrite
    m.output += r.output; m.reasoning += r.reasoning
    m.costCny += r.costCny; m.calls += 1
    if (!r.priced) m.priced = false
    if (!m.rawModels.includes(r.model)) m.rawModels.push(r.model)
    const tokens = r.input + r.cacheRead + r.cacheWrite + r.output
    if (r.priced && tokens > 0) slot.rates.add(Number((r.costCny / tokens).toFixed(12)))
  }

  const out = [...byKey.values()].map(({ row, rates }) => {
    row.rawModels.sort()
    row.mixedRate = rates.size > 1
    return row
  })
  return out.sort((a, b) => b.costCny - a.costCny || a.key.localeCompare(b.key))
}

export function filterRows(
  rows: readonly LedgerRow[],
  opts: { includeSubagents: boolean },
): LedgerRow[] {
  return opts.includeSubagents ? [...rows] : rows.filter((r) => !r.isSubagent)
}

export function buildDaily(rows: readonly LedgerRow[], days: readonly string[]): DailyPoint[] {
  const byDay = new Map<string, DailyPoint>()
  for (const day of days) {
    byDay.set(day, { day, costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 })
  }
  const extra: DailyPoint[] = []
  for (const r of rows) {
    let p = byDay.get(r.day)
    if (p === undefined) {
      p = { day: r.day, costCny: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 }
      byDay.set(r.day, p); extra.push(p)
    }
    p.costCny += r.costCny; p.input += r.input; p.cacheRead += r.cacheRead
    p.cacheWrite += r.cacheWrite; p.output += r.output; p.calls += 1
  }
  const known = days.map((d) => byDay.get(d)!)
  const outside = extra.filter((p) => !days.includes(p.day)).sort((a, b) => a.day.localeCompare(b.day))
  return [...outside, ...known]
}

export function buildBySession(rows: readonly LedgerRow[]): SessionRow[] {
  const byId = new Map<string, SessionRow>()
  for (const r of rows) {
    let s = byId.get(r.sessionId)
    if (s === undefined) {
      s = {
        sessionId: r.sessionId, day: r.day, calls: 0, costCny: 0,
        lastTime: r.time, isSubagent: r.isSubagent,
      }
      byId.set(r.sessionId, s)
    }
    // 取首个「已定义」的 cwd：首行缺 cwd 时后面的行可以补上。
    if (s.cwd === undefined && r.cwd !== undefined) s.cwd = r.cwd
    s.calls += 1; s.costCny += r.costCny
    if (r.time > s.lastTime) s.lastTime = r.time
    if (r.day < s.day) s.day = r.day
  }
  return [...byId.values()].sort((a, b) => b.costCny - a.costCny || a.sessionId.localeCompare(b.sessionId))
}

export function buildByWorkspace(rows: readonly LedgerRow[]): WorkspaceRow[] {
  const sessions = buildBySession(rows)
  const byCwd = new Map<string, WorkspaceRow>()
  for (const s of sessions) {
    const cwd = s.cwd ?? UNKNOWN_WORKSPACE
    let w = byCwd.get(cwd)
    if (w === undefined) { w = { cwd, calls: 0, costCny: 0, sessions: [] }; byCwd.set(cwd, w) }
    w.calls += s.calls; w.costCny += s.costCny; w.sessions.push(s)
  }
  return [...byCwd.values()].sort((a, b) => b.costCny - a.costCny || a.cwd.localeCompare(b.cwd))
}

/**
 * 概览指标。其中 `cacheHitRate = cacheRead / (input + cacheRead)`，**分母遍历全部行**
 * （未计价行也计入：它们携带真实观测 token），且**不含 cacheWrite**；详见 `Overview.cacheHitRate`。
 */
export function buildOverview(
  rows: readonly LedgerRow[],
  opts: { todayKey: string; weekDays: readonly string[] },
): Overview {
  let totalCny = 0; let todayCny = 0; let weekCny = 0; let calls = 0
  let hit = 0; let inputTotal = 0; let unpricedRows = 0; let hasBackfilled = false
  const unpricedModels = new Set<string>()
  const days = new Set<string>()

  for (const r of rows) {
    totalCny += r.costCny; calls += 1; days.add(r.day)
    if (r.day === opts.todayKey) todayCny += r.costCny
    if (opts.weekDays.includes(r.day)) weekCny += r.costCny
    inputTotal += r.input + r.cacheRead
    hit += r.cacheRead
    if (!r.priced) { unpricedRows += 1; unpricedModels.add(priceKey(r.provider, r.model)) }
    if (r.backfilled) hasBackfilled = true
  }

  return {
    totalCny, todayCny, weekCny, calls,
    avgDailyCny: days.size === 0 ? 0 : totalCny / days.size,
    cacheHitRate: inputTotal === 0 ? 0 : hit / inputTotal,
    unpricedModels: [...unpricedModels].sort(),
    unpricedRows,
    hasBackfilled,
  }
}
