/**
 * 截止日期工具：按本地日取整，日键 / chips 文案 / date-input 互转同源。
 * 截止值存绝对 ms（当天 0 点），跨时区不换算。
 */

const DAY_MS = 86_400_000

/** 相对今天的日差（按日取整）。 */
function dayDiff(ts: number, now: number): number {
  return Math.round((startOfDay(ts) - startOfDay(now)) / DAY_MS)
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 日键 'YYYY-MM-DD'（本地日，月/日补零）。 */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `M-D`，跨年补全为 `YYYY-M-D`。 */
export function fmtMonthDay(ts: number, now: number = Date.now()): string {
  const d = new Date(ts)
  const md = `${d.getMonth() + 1}-${d.getDate()}`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}-${md}`
}

/**
 * 截止 chips 文案：逾期 N 天 / 今天 / 明天 / N 天后（7 天内）/ M-D。
 * 无截止值返回空串，调用方据此决定要不要画 chip。
 */
export function fmtDueChip(ts: number, now: number = Date.now()): string {
  const diff = dayDiff(ts, now)
  if (diff < 0) return `逾期 ${-diff} 天`
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff <= 7) return `${diff} 天后`
  return fmtMonthDay(ts, now)
}

/** 逾期 / 今明两天 / 常规：驱动 chips 的语义色。 */
export function dueTone(ts: number, now: number = Date.now()): 'overdue' | 'soon' | 'normal' {
  const diff = dayDiff(ts, now)
  if (diff < 0) return 'overdue'
  if (diff <= 1) return 'soon'
  return 'normal'
}

/** 绝对 ms → `<input type="date">` 的 value（本地日）。 */
export function toDateInputValue(ts: number): string {
  return dayKey(ts)
}

/** `<input type="date">` 的 value → 当天 0 点的绝对 ms；空串 = 未选。 */
export function fromDateInputValue(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return undefined
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? undefined : date.getTime()
}

export function endAtFromDayInput(value: string): number | undefined {
  const day = fromDateInputValue(value)
  return day === undefined ? undefined : day + DAY_MS - 1
}

export function defaultEndAt(now: number): number {
  return endAtFromDayInput(toDateInputValue(now + 30 * DAY_MS)) ?? now + 30 * DAY_MS
}
