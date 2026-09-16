/** 日历热力图矩阵与五档色阶（纯函数）。 */

export const HEAT_SCALE = [0, 0.25, 0.5, 0.75, 1] as const

export type HeatLevel = 0 | 1 | 2 | 3 | 4

/**
 * 按 value/max 落入 5 档；max<=0 时一律 0 档。
 */
export function heatLevel(value: number, max: number): HeatLevel {
  if (!(max > 0) || !(value > 0)) return 0
  const r = value / max
  // 档位必须随 r 单调不减，且与 HEAT_SCALE 的四个阈值同侧判定：
  // (0,0.25]→1、(0.25,0.5]→2、(0.5,0.75]→3、(0.75,1]→4。
  if (r > 0.75) return 4
  if (r > 0.5) return 3
  if (r > 0.25) return 2
  return 1
}

export interface HeatCell { day: string; value: number; level: HeatLevel }

/**
 * 把连续日期铺成按周分行的矩阵（每行恒 7 格，空位 null）。
 * 行内位置由该日期的星期决定，避免依赖输入顺序。
 */
export function calendarMatrix(
  days: readonly string[],
  values: ReadonlyMap<string, number>,
  opts: { firstDayOfWeek?: 0 | 1 } = {},
): Array<Array<HeatCell | null>> {
  if (days.length === 0) return []
  const first = opts.firstDayOfWeek ?? 1
  const max = Math.max(0, ...[...values.values()])
  const rows: Array<Array<HeatCell | null>> = []
  let row: Array<HeatCell | null> = new Array(7).fill(null)
  let weekStart = Number.NaN

  for (const day of days) {
    const [y, m, d] = day.split('-').map(Number)
    if (y === undefined || m === undefined || d === undefined) continue
    const weekday = new Date(y, m - 1, d).getDay()
    const col = (weekday - first + 7) % 7
    // 按「周起点」换行，不能只看列号：列号在跨周时只会回退或持平，
    // 日期相差恰好一周多一天（如 09-01 → 09-09）列号反而递增，会被并进同一行。
    const dayNum = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
    const start = dayNum - col
    if (!Number.isNaN(weekStart) && (start !== weekStart || row[col] !== null)) {
      rows.push(row)
      row = new Array(7).fill(null)
    }
    weekStart = start
    const value = values.get(day) ?? 0
    row[col] = { day, value, level: heatLevel(value, max) }
  }
  rows.push(row)
  return rows
}
