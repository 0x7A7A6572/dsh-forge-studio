/**
 * 游走纯函数（§卡16）：可行走网格上的确定性漫游与归位。
 * 不 import react；状态经 memo 跨帧回传；全部输入显式，无内部时钟。
 */
import { fnv1a32 } from './seed-hash.ts'
import {
  WALK_GRID_CELL,
  WALK_GRID_COLS,
  WALK_GRID_ROWS,
  WALK_GRID,
  WALK_GRID_KIND,
} from './walk-grid.generated.ts'
import type { PixelPoint, StudioWanderState } from './scene-types.ts'

/** 游走目标只允许原始地板格（kind===0）：carve/seat 可通行但不可作目标。 */
export const TARGET_KIND_FLOOR = 0

/** 运行时可行走网格（由生成常量组装）。 */
export interface WanderGrid {
  readonly cols: number
  readonly rows: number
  readonly cell: number
  readonly blocked: Uint8Array
  /** 格子分类：0=floor / 1=blocked / 2=carve / 3=seat。 */
  readonly kind: Uint8Array
}

/** 游走速度（px/ms）：10px/s。归位速度 ×4。 */
const WALK_PX_PER_MS = 10 / 1000
const RETURN_PX_PER_MS = (10 * 4) / 1000

let cachedGrid: WanderGrid | null = null

/** 由生成常量组装网格（模块级缓存常量；每次返回独立副本，防外部改缓存）。 */
export function walkGrid(): WanderGrid {
  if (cachedGrid === null) {
    cachedGrid = {
      cols: WALK_GRID_COLS,
      rows: WALK_GRID_ROWS,
      cell: WALK_GRID_CELL,
      blocked: new Uint8Array(WALK_GRID),
      kind: new Uint8Array(WALK_GRID_KIND),
    }
  }
  return {
    cols: cachedGrid.cols,
    rows: cachedGrid.rows,
    cell: cachedGrid.cell,
    blocked: new Uint8Array(cachedGrid.blocked),
    kind: new Uint8Array(cachedGrid.kind),
  }
}

export function isWalkableCell(grid: WanderGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows &&
    grid.blocked[row * grid.cols + col] === 0
}

/** 可通行且是原始地板（kind===0）：游走目标口径（carve/seat 可通行但不可选）。 */
export function isFloorCell(grid: WanderGrid, col: number, row: number): boolean {
  return isWalkableCell(grid, col, row) &&
    grid.kind[row * grid.cols + col] === TARGET_KIND_FLOOR
}

function cellCenter(grid: WanderGrid, col: number, row: number): PixelPoint {
  return { x: col * grid.cell + grid.cell / 2, y: row * grid.cell + grid.cell / 2 }
}

function cellOf(grid: WanderGrid, p: PixelPoint): { col: number; row: number } {
  return { col: Math.floor(p.x / grid.cell), row: Math.floor(p.y / grid.cell) }
}

const dist = (a: PixelPoint, b: PixelPoint): number =>
  Math.hypot(a.x - b.x, a.y - b.y)

/** 一次选目标最多做几次「可达性」校验（planPath 为 null 就换 k 重试）。 */
const MAX_TARGET_REACH_TRIES = 8

/**
 * 确定性选目标：hash(seed, visitIndex, k) 拒绝采样（≤24 次）选距离 ≥24px 且
 * 与当前位置**同一连通分量**的原始地板格（kind===0，排除 carve/seat）；
 * planPath 为 null 就换 k 重试，≤8 次。全败返回 null（原地停留）。
 */
export function pickTarget(
  seed: string,
  visitIndex: number,
  grid: WanderGrid,
  current: PixelPoint,
): PixelPoint | null {
  let reachTries = 0
  for (let k = 0; k < 24; k++) {
    const h = fnv1a32(`${seed}:${visitIndex}:${k}`)
    const col = h % grid.cols
    const row = 15 + Math.floor((h >>> 9) % Math.max(1, grid.rows - 15))
    // 目标必须是原始地板：carve（出座/连接通道）与 seat 可通行但不可选。
    if (!isFloorCell(grid, col, row)) continue
    const candidate = cellCenter(grid, col, row)
    if (dist(candidate, current) < 24) continue
    // 可达性门禁：目标必须与当前位置同一连通分量，否则换 k 重试。
    if (planPath(grid, current, candidate) === null) {
      reachTries += 1
      if (reachTries >= MAX_TARGET_REACH_TRIES) return null
      continue
    }
    return candidate
  }
  return null
}

/** 网格 BFS（4 邻接）：返回格中心路径（不含起点、含终点）；不可达/起点不可走返回 null。 */
export function planPath(grid: WanderGrid, from: PixelPoint, to: PixelPoint): PixelPoint[] | null {
  const a = cellOf(grid, from)
  const b = cellOf(grid, to)
  // 起点也必须可走（座位格由生成期标为 kind=seat，WALK_GRID=0），否则 BFS 会从墙里穿出去。
  if (!isWalkableCell(grid, a.col, a.row)) return null
  if (!isWalkableCell(grid, b.col, b.row)) return null
  const key = (c: number, r: number) => r * grid.cols + c
  const prev = new Map<number, number>()
  const queue: Array<{ col: number; row: number }> = [{ col: a.col, row: a.row }]
  const seen = new Set<number>([key(a.col, a.row)])
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.col === b.col && cur.row === b.row) break
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      const k = key(nc, nr)
      if (seen.has(k) || !isWalkableCell(grid, nc, nr)) continue
      seen.add(k)
      prev.set(k, key(cur.col, cur.row))
      queue.push({ col: nc, row: nr })
    }
  }
  if (!seen.has(key(b.col, b.row))) return null
  const path: PixelPoint[] = []
  let k = key(b.col, b.row)
  const startK = key(a.col, a.row)
  while (k !== startK) {
    path.push(cellCenter(grid, k % grid.cols, Math.floor(k / grid.cols)))
    const p = prev.get(k)
    if (p === undefined) return null
    k = p
  }
  return path.reverse()
}

export interface AdvanceWanderOpts {
  memberId: string
  seed: string
  grid: WanderGrid
  /** 座位脚底锚点（归位目标）。 */
  seat: PixelPoint
  /** 是否 idle（true = 游走；false = 归位）。 */
  idle: boolean
  now: number
  dtMs: number
}

export interface AdvanceWanderResult {
  /** 新状态（null = 已归位/无需状态）。 */
  state: StudioWanderState | null
  /** 实时脚底坐标。 */
  foot: PixelPoint
  /** 是否在移动（步伐抖动/朝向用）。 */
  moving: boolean
  /** 本帧位移 dx（朝向用；0 = 静止）。 */
  moveDx: number
}

function stepToward(foot: PixelPoint, to: PixelPoint, budgetPx: number): { foot: PixelPoint; arrived: boolean; dx: number } {
  const d = dist(foot, to)
  if (d <= budgetPx) return { foot: { ...to }, arrived: true, dx: to.x - foot.x }
  const t = budgetPx / d
  return { foot: { x: foot.x + (to.x - foot.x) * t, y: foot.y + (to.y - foot.y) * t }, arrived: false, dx: to.x - foot.x }
}

/**
 * 推进一帧游走：
 * - idle：沿 path 以 10px/s 移动；到达后停留 2-4s（seed 派生）再选下一个目标。
 * - 非 idle：目标 = 座位锚点，速度 ×4 归位；到达后状态清空（foot = 座位）。
 * 返回的 state 为 null 表示成员已归位（调用方按在位渲染）。
 */
export function advanceWander(
  state: StudioWanderState | null,
  opts: AdvanceWanderOpts,
): AdvanceWanderResult {
  const { seed, grid, seat, idle, now, dtMs } = opts
  const clampDt = Math.max(0, Math.min(dtMs, 200))
  // 非 idle：归位（无状态 = 已在座位）。只走网格路径；不可达就原地等下一帧（不直线穿墙）。
  if (!idle) {
    if (state === null) return { state: null, foot: seat, moving: false, moveDx: 0 }
    const cur = state.foot
    let path: PixelPoint[] = []
    if (state.returning && state.path.length > 0) {
      path = [...state.path]
    } else {
      const planned = planPath(grid, cur, seat)
      if (planned === null) {
        // 归位路径不可达：保持原地，下一帧重试（禁止 stepToward 直线穿墙）。
        return {
          state: { ...state, foot: cur, returning: true, target: seat, path: [] },
          foot: cur, moving: false, moveDx: 0,
        }
      }
      path = planned
    }
    let budget = RETURN_PX_PER_MS * clampDt
    let foot = cur
    let dx = 0
    while (budget > 0 && path.length > 0) {
      const wp = path[0]
      const step = stepToward(foot, wp, budget)
      budget -= dist(foot, step.foot)
      foot = step.foot
      dx = step.dx
      if (step.arrived) path.shift()
      else break
    }
    if (path.length === 0) {
      // 最后一格 = 座位格（生成期出座通道保证）；格内直线走到座位锚点，不穿墙。
      const step = stepToward(foot, seat, budget)
      foot = step.foot
      if (step.arrived) return { state: null, foot: seat, moving: false, moveDx: 0 }
      return {
        state: { ...state, foot, returning: true, target: seat, path: [] },
        foot, moving: true, moveDx: step.dx,
      }
    }
    return {
      state: { ...state, foot, path, returning: true, target: seat },
      foot, moving: true, moveDx: dx,
    }
  }
  // idle 游走。
  const waitMsFor2 = (index: number) => 2000 + (fnv1a32(`${seed}:${index}:wait`) % 2000)
  if (state === null) {
    // 首次出发：从座位选目标。
    const target = pickTarget(seed, 0, grid, seat)
    const path = target === null ? null : planPath(grid, seat, target)
    if (target === null || path === null) {
      // 选不到可达目标：原地停留。visitIndex 前移，避免下次命中同一组哈希（确定性死循环）。
      return {
        state: { visitIndex: 1, target: null, path: [], foot: seat, waitUntil: now + 1000, returning: false },
        foot: seat, moving: false, moveDx: 0,
      }
    }
    state = { visitIndex: 0, target, path, foot: seat, waitUntil: 0, returning: false }
  }
  if (now < state.waitUntil) {
    return { state, foot: state.foot, moving: false, moveDx: 0 }
  }
  if (state.path.length === 0) {
    // 已在目标点：选下一个目标（visitIndex+1）；选不到/不可达 → 原地再停 1s。
    const nextIndex = state.visitIndex + 1
    const target = pickTarget(seed, nextIndex, grid, state.foot)
    const path = target === null ? null : planPath(grid, state.foot, target)
    if (target === null || path === null) {
      // visitIndex 必须前移：否则等待结束后会再次命中同一组哈希，永久原地。
      return {
        state: { ...state, visitIndex: nextIndex, waitUntil: now + 1000 },
        foot: state.foot, moving: false, moveDx: 0,
      }
    }
    state = { ...state, visitIndex: nextIndex, target, path, waitUntil: 0 }
  }
  // 沿路径移动（逐路径点消耗步长预算）。
  let budget = WALK_PX_PER_MS * clampDt
  let foot = state.foot
  let dx = 0
  const path = [...state.path]
  while (budget > 0 && path.length > 0) {
    const wp = path[0]
    const step = stepToward(foot, wp, budget)
    budget -= dist(foot, step.foot)
    foot = step.foot
    dx = step.dx
    if (step.arrived) path.shift()
    else break
  }
  if (path.length === 0) {
    // 到达目标：停留至 waitUntil（visitIndex 保持，等待帧结束后 +1 选新目标）。
    return {
      state: { ...state, path: [], foot, waitUntil: now + waitMsFor2(state.visitIndex) },
      foot, moving: false, moveDx: 0,
    }
  }
  return {
    state: { ...state, path, foot, returning: false },
    foot, moving: true, moveDx: dx,
  }
}
