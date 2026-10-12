import { aliasId } from './model-key.ts'
import { priceKey } from './pricing/catalog.ts'
import { sameModelName } from './model-key.ts'
import type { LedgerRow, ModelAlias } from './types.ts'

export interface ModelRow {
  /** 同名模型的分组键，也是展示名。 */
  key: string
  /** 覆盖到的 provider（排序去重），可能不止一个。 */
  providers: string[]
  /** = providers[0]，兼容单 provider 读法。 */
  provider: string
  model: string
  rawModels: string[]
  input: number; cacheRead: number; cacheWrite: number; output: number; reasoning: number
  costCny: number
  /** false 表示至少一行未计价；costCny 仍可能非零。 */
  priced: boolean
  /** 按行内「每 token 成本比」是否唯一置位，不是比单价。 */
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
  /** 只算 day === todayKey 的行，与 costCny 同一次响应。 */
  todayCny: number
  /** 历史累计（全账本，不按时间窗），由 attachAllCny 填。 */
  allCny: number
}

export interface WorkspaceRow {
  cwd: string; calls: number; costCny: number
  /** 只算今天，与 costCny 同一次响应。 */
  todayCny: number
  /** 历史累计（全账本），同样由 attachAllCny 填。 */
  allCny: number
  sessions: SessionRow[]
}

/** 必须与它描述的金额同源：同一次响应、同一行集。 */
export interface LedgerMarkers {
  /** 是否有 `time < installAt` 的回填行（估算）。 */
  hasBackfilled: boolean
  /** 账本原始 `provider/model` id，不是别名后的名字。 */
  unpricedModels: string[]
}

export function buildMarkers(rows: readonly LedgerRow[]): LedgerMarkers {
  let hasBackfilled = false
  const unpriced = new Set<string>()
  for (const r of rows) {
    if (r.backfilled) hasBackfilled = true
    if (!r.priced) unpriced.add(priceKey(r.provider, r.model))
  }
  return { hasBackfilled, unpricedModels: [...unpriced].sort() }
}

export interface Overview extends LedgerMarkers {
  totalCny: number; todayCny: number; weekCny: number; avgDailyCny: number
  /** cacheRead / (input + cacheRead)；分母不含 cacheWrite，空分母为 0。 */
  cacheHitRate: number
  calls: number
  unpricedRows: number
}

export const UNKNOWN_WORKSPACE = '未知工作区'

function emptyModel(key: string, provider: string, model: string): ModelRow {
  return {
    key, providers: [provider], provider, model, rawModels: [],
    input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0,
    costCny: 0, priced: true, mixedRate: false, calls: 0,
  }
}

/** 跨 provider 按同名模型合并；分组键取别名 canonical（有则优先）。 */
export function mergeByModel(rows: readonly LedgerRow[], aliases: readonly ModelAlias[]): ModelRow[] {
  const canon = new Map<string, string>()
  for (const a of aliases) canon.set(a.id, a.canonicalModel)
  const byKey = new Map<string, { row: ModelRow; rates: Set<number> }>()

  for (const r of rows) {
    const provider = r.provider.trim().toLowerCase()
    // trim 后为空的 canonical 无效，口径同 model-key.ts。
    const rawCanonical = canon.get(aliasId(provider, r.model))
    const canonical = rawCanonical !== undefined && rawCanonical.trim() !== '' ? rawCanonical : r.model
    const key = sameModelName(canonical)
    let slot = byKey.get(key)
    if (slot === undefined) {
      slot = { row: emptyModel(key, provider, key), rates: new Set() }
      byKey.set(key, slot)
    }
    const m = slot.row
    if (!m.providers.includes(provider)) {
      m.providers.push(provider)
      m.providers.sort()
      m.provider = m.providers[0]!
    }
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

export function buildBySession(rows: readonly LedgerRow[], todayKey: string): SessionRow[] {
  const byId = new Map<string, SessionRow>()
  for (const r of rows) {
    let s = byId.get(r.sessionId)
    if (s === undefined) {
      s = {
        sessionId: r.sessionId, day: r.day, calls: 0, costCny: 0, todayCny: 0, allCny: 0,
        lastTime: r.time, isSubagent: r.isSubagent,
      }
      byId.set(r.sessionId, s)
    }
    if (s.cwd === undefined && r.cwd !== undefined) s.cwd = r.cwd
    s.calls += 1; s.costCny += r.costCny
    if (r.day === todayKey) s.todayCny += r.costCny
    if (r.time > s.lastTime) s.lastTime = r.time
    if (r.day < s.day) s.day = r.day
  }
  return [...byId.values()].sort((a, b) => b.costCny - a.costCny || a.sessionId.localeCompare(b.sessionId))
}

export function buildByWorkspace(rows: readonly LedgerRow[], todayKey: string): WorkspaceRow[] {
  const sessions = buildBySession(rows, todayKey)
  const byCwd = new Map<string, WorkspaceRow>()
  for (const s of sessions) {
    const cwd = s.cwd ?? UNKNOWN_WORKSPACE
    let w = byCwd.get(cwd)
    if (w === undefined) { w = { cwd, calls: 0, costCny: 0, todayCny: 0, allCny: 0, sessions: [] }; byCwd.set(cwd, w) }
    w.calls += s.calls; w.costCny += s.costCny; w.todayCny += s.todayCny; w.sessions.push(s)
  }
  return [...byCwd.values()].sort((a, b) => b.costCny - a.costCny || a.cwd.localeCompare(b.cwd))
}

/** 两样都从全账本汇总；子代理口径须与窗口金额一致。 */
export function attachAllCny(
  workspaces: readonly WorkspaceRow[],
  all: readonly LedgerRow[],
  includeSubagents: boolean,
): void {
  const bySession = new Map<string, number>()
  const byCwd = new Map<string, number>()
  for (const r of filterRows(all, { includeSubagents })) {
    bySession.set(r.sessionId, (bySession.get(r.sessionId) ?? 0) + r.costCny)
    const cwd = r.cwd ?? UNKNOWN_WORKSPACE
    byCwd.set(cwd, (byCwd.get(cwd) ?? 0) + r.costCny)
  }
  for (const w of workspaces) {
    // 缺了就退到窗口值，宁可少算也不写成 0。
    for (const s of w.sessions) s.allCny = bySession.get(s.sessionId) ?? s.costCny
    w.allCny = byCwd.get(w.cwd) ?? w.costCny
  }
}

export function buildOverview(
  rows: readonly LedgerRow[],
  opts: { todayKey: string; weekDays: readonly string[] },
): Overview {
  let totalCny = 0; let todayCny = 0; let weekCny = 0; let calls = 0
  let hit = 0; let inputTotal = 0; let unpricedRows = 0
  const days = new Set<string>()

  for (const r of rows) {
    totalCny += r.costCny; calls += 1; days.add(r.day)
    if (r.day === opts.todayKey) todayCny += r.costCny
    if (opts.weekDays.includes(r.day)) weekCny += r.costCny
    inputTotal += r.input + r.cacheRead
    hit += r.cacheRead
    if (!r.priced) unpricedRows += 1
  }

  return {
    ...buildMarkers(rows),
    totalCny, todayCny, weekCny, calls,
    avgDailyCny: days.size === 0 ? 0 : totalCny / days.size,
    cacheHitRate: inputTotal === 0 ? 0 : hit / inputTotal,
    unpricedRows,
  }
}
