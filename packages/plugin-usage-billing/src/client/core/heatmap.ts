/** 日历热力图矩阵与五档色阶（纯函数）。 */

export const HEAT_SCALE = [0, 0.25, 0.5, 0.75, 1] as const

export type HeatLevel = 0 | 1 | 2 | 3 | 4

/**
 * 按 value/max 落入 5 档；max<=0 时一律 0 档。
 *
 * 档位阈值直接取自 `HEAT_SCALE`（除 0 档与顶档），不另行硬编码：
 * 只改常量就能改分档，不会出现「常量改了、函数没改」的静默漂移。
 */
export function heatLevel(value: number, max: number): HeatLevel {
  if (!(max > 0) || !(value > 0)) return 0
  const r = value / max
  // 档位必须随 r 单调不减，且与 HEAT_SCALE 的**中间三个**阈值同侧判定：
  // (0, HEAT_SCALE[1]]→1、…、超过 HEAT_SCALE[len-2]→顶档（0 档与顶档没有内部阈值）。
  for (let level = 1; level < HEAT_SCALE.length - 1; level += 1) {
    if (r <= HEAT_SCALE[level]) return level as HeatLevel
  }
  return 4
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
  const placed = new Set<string>()

  for (const day of days) {
    const [y, m, d] = day.split('-').map(Number)
    // `'abc-def-gh'` 解构出的是 NaN 而不是 undefined：必须按整数校验，
    // 否则会写入 `row[NaN]` 这种幻影属性（矩阵长度看着对，键却多一个）。
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) continue
    // 同一天重复出现时跳过：`row[col] !== null` 曾触发换行，把一周拆成两行。
    if (placed.has(day)) continue
    const weekday = new Date(y, m - 1, d).getDay()
    const col = (weekday - first + 7) % 7
    // 按「周起点」换行，不能只看列号：列号在跨周时只会回退或持平，
    // 日期相差恰好一周多一天（如 09-01 → 09-09）列号反而递增，会被并进同一行。
    const dayNum = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
    const start = dayNum - col
    if (!Number.isNaN(weekStart) && start !== weekStart) {
      rows.push(row)
      row = new Array(7).fill(null)
      // 输入可能**跳周**：'all' 路径会把窗口之前的历史日期前置到序列头部（view.ts 的
      // buildDaily），与 90 天窗口的尾部隔着若干周。只推一行会让那段历史紧贴窗口末尾，
      // 色阶的时间轴就读错了 —— 中间每个缺失的整周都补一个空行。
      if (start > weekStart) {
        for (let w = weekStart + 7; w < start; w += 7) rows.push(new Array(7).fill(null))
      }
    }
    weekStart = start
    const value = values.get(day) ?? 0
    row[col] = { day, value, level: heatLevel(value, max) }
    placed.add(day)
  }
  rows.push(row)
  return rows
}
