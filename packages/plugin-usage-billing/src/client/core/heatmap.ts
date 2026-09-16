/** 日历热力图矩阵与五档色阶（纯函数）。 */

export const HEAT_SCALE = [0, 0.25, 0.5, 0.75, 1] as const

export type HeatLevel = 0 | 1 | 2 | 3 | 4

/**
 * 按 value/max 落入 5 档；max<=0 时一律 0 档。
 *
 * **偏离 brief 的代码块，已报告**：brief 的实现写成
 * `if (r >= 1) return 4; if (r >= 0.75) return 3; if (r >= 0.5) return 2; if (r > 0.25) return 1; ...`
 * —— 后三个分支全部 `return 1`，于是 `heatLevel(25.1, 100)`（r=0.251）返回 1，而 brief 自己的测试
 * 断言它必须是 2，且 2/3 档的实际可达区间被压成空集。这里按 HEAT_SCALE 的档边界
 * （(0.25, 0.5] → 2、(0.5, 0.75] → 3、(0.75, 1] → 4）改回单调分档，其余（0 档守卫、导出、矩阵）逐字照抄。
 */
export function heatLevel(value: number, max: number): HeatLevel {
  if (!(max > 0) || !(value > 0)) return 0
  const r = value / max
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

  for (const day of days) {
    const [y, m, d] = day.split('-').map(Number)
    if (y === undefined || m === undefined || d === undefined) continue
    const weekday = new Date(y, m - 1, d).getDay()
    const col = (weekday - first + 7) % 7
    if (row[col] !== null || (rows.length > 0 && rows[rows.length - 1] === row && row.every((c) => c !== null))) {
      rows.push(row)
      row = new Array(7).fill(null)
    }
    const value = values.get(day) ?? 0
    row[col] = { day, value, level: heatLevel(value, max) }
  }
  rows.push(row)
  return rows
}
