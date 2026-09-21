/**
 * 展示视图：把账本行按各维度聚成 UI 直接可用的形状。
 *
 * **别名只在这里生效**（spec §5.5）：账本永远是原始 id，金额已锁定；合并 = token 与
 * 金额直接相加。合并**只在同一 provider 内**，不跨 provider。
 * 所有函数都是纯函数，缓存由 service 层的 LRU 负责。
 */

import { aliasId } from './model-key.ts'
import { priceKey } from './pricing/catalog.ts'
import { sameModelName } from './model-key.ts'
import type { LedgerRow, ModelAlias } from './types.ts'

export interface ModelRow {
  /** 同名模型的分组键（`sameModelName` 的结果），也是这一行的展示名。 */
  key: string
  /** 这一行覆盖到的全部 provider（排序去重）。同名模型跨 provider 会并成一行，所以可能不止一个。 */
  providers: string[]
  /** 主 provider = `providers[0]`（单 provider 行的兼容字段）。 */
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
  /** 该会话**今天**的金额（day === todayKey 的那部分）；与 costCny 同源、同一次响应。 */
  todayCny: number
  /** 该会话的**历史累计**（不按时间窗过滤，只跟子代理口径走）：由 attachAllCny 从全账本填。 */
  allCny: number
}

export interface WorkspaceRow {
  cwd: string; calls: number; costCny: number
  /** 该项目**今天**的金额：popup 的「今日消耗分布」用它，与 costCny 同源、同一次响应。 */
  todayCny: number
  /** 该项目的**历史累计**：只汇总窗口内的会话会漏掉更早的会话，所以同样由 attachAllCny 填。 */
  allCny: number
  sessions: SessionRow[]
}

/**
 * 每个携带金额的响应都必须**自带**的口径标记。
 *
 * 存在的理由（review fix round 2）：UI 曾用「第二次 overview 取数」单独判断回填，
 * 那次取数失败时金额照常渲染、披露却消失 —— 一个带估算的金额被无声地显示成精确值。
 * 标记必须与它描述的金额同源（同一次响应、同一行集），所以这里由 host 随值一起算出来。
 */
export interface LedgerMarkers {
  /** 该行集里是否有 `time < installAt` 的回填行（估算）。 */
  hasBackfilled: boolean
  /**
   * 该行集里的未计价模型（**账本原始** `provider/model` id）。整份账一行都没定价时
   * `totalCny === 0`，UI 必须据此显示 `'—'` 而不是 `¥0.00`（详见 client/core/format.ts）。
   */
  unpricedModels: string[]
}

/** 从同一个行集算出金额披露标记；`buildOverview` 也用这条路径，口径不可能分叉。 */
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
  /**
   * 缓存命中率 = cacheRead / (input + cacheRead)。
   * 分母含未计价行（它们同样携带真实观测 token，剔除会让该比值与旁边的 token 合计口径打架）；
   * 分母**不含 cacheWrite**（缓存写入不是「读取命中」的分母）。空分母时为 0。
   */
  cacheHitRate: number
  calls: number
  /**
   * 未计价模型（继承 `LedgerMarkers`）：刻意使用**账本原始** `provider/model` id ——
   * `buildOverview` 拿不到别名表，且原始 id 正是用户需要去补价格的那个名字。
   */
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

/**
 * 按**同名模型**合并（跨 provider）——「同名就是同一个模型，别拆成两行」。
 *
 * 分组键是 `sameModelName(canonical)`：手工别名的 canonical 优先（所以别名照旧能把
 * 别名链上的 id 收拢到一行、也能强制改名），否则用原始 model id 归一后的名字。
 * provider **不进分组键**，但一个都不丢：行的 `providers` 列全部覆盖到的 provider，
 * 客户端把它们显示成 `a / b / 模型名`；`provider` 保留为 `providers[0]` 兼容单 provider 的读法。
 *
 * 跨 provider 合并会把两家的单价混进一行 —— 这正是 `mixedRate` 存在的地方：
 * 它按行内「每 token 成本比」是否唯一置位，界面据此标注「混合单价」。
 */
export function mergeByModel(rows: readonly LedgerRow[], aliases: readonly ModelAlias[]): ModelRow[] {
  const canon = new Map<string, string>()
  for (const a of aliases) canon.set(a.id, a.canonicalModel)
  const byKey = new Map<string, { row: ModelRow; rates: Set<number> }>()

  for (const r of rows) {
    const provider = r.provider.trim().toLowerCase()
    // 空（含纯空白）canonical 不是有效的合并目标：它 trim 后为空，并进去等于把所有同名行
    // 都压成一行没有名字的东西。判定口径与 model-key.ts 一致：trim 后为空即无效。
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

/**
 * 按会话聚合。今日字段与总额出自**同一批行**（同一次响应），所以「本会话今日 ≤ 本项目今日 ≤
 * 今日总额」这类包含关系在界面上永远成立，不靠两次取数去拼。
 */
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
    // 取首个「已定义」的 cwd：首行缺 cwd 时后面的行可以补上。
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

/**
 * 给窗口里的会话与项目补上**历史累计**：两样都从全账本汇总 —— 只把窗口内的会话加起来
 * 会漏掉这个项目更早的会话。子代理口径与窗口金额一致，不能各算一套。
 */
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
    // 窗口里的会话必定也在全账本里；万一缺了，退到窗口值，宁可少算也不写成 0。
    for (const s of w.sessions) s.allCny = bySession.get(s.sessionId) ?? s.costCny
    w.allCny = byCwd.get(w.cwd) ?? w.costCny
  }
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

  // hasBackfilled / unpricedModels 由同一条路径算出：overview 与 daily / byModel /
  // byWorkspace 的口径不可能分叉（review fix round 2）。
  return {
    ...buildMarkers(rows),
    totalCny, todayCny, weekCny, calls,
    avgDailyCny: days.size === 0 ? 0 : totalCny / days.size,
    cacheHitRate: inputTotal === 0 ? 0 : hit / inputTotal,
    unpricedRows,
  }
}
