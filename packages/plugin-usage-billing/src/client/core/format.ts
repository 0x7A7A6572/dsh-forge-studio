/**
 * Display formatting (pure functions). Money is always CNY, thousands-separated and
 * never abbreviated (spec 7.3).
 *
 * Unified contract for non-finite input: all four formatters return the placeholder
 * — and never ¥0.00 / '0'. "Cannot be computed" and "spent zero"
 * must stay distinguishable in the UI -- rendering `NaN` or `-Infinity` as "no spend"
 * is a confident false statement (`-Infinity` used to render as an *unsigned* ¥0.00).
 * Same stance as the entry card's placeholder for an entirely unpriced ledger.
 */

/** Placeholder for non-finite input (same glyph as the entry card's PENDING). */
export const NON_FINITE_PLACEHOLDER = '—'

function thousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatCny(n: number): string {
  if (!Number.isFinite(n)) return NON_FINITE_PLACEHOLDER
  if (Math.abs(n) < 0.01) return n === 0 ? '¥0.00' : '<¥0.01'
  const fixed = Math.abs(n).toFixed(2)
  const [int = '0', frac = '00'] = fixed.split('.')
  return `${n < 0 ? '-' : ''}¥${thousands(int)}.${frac}`
}

export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return NON_FINITE_PLACEHOLDER
  const rounded = Math.round(n)
  return `${rounded < 0 ? '-' : ''}${thousands(String(Math.abs(rounded)))}`
}

export function formatPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return NON_FINITE_PLACEHOLDER
  return `${(n * 100).toFixed(digits)}%`
}

export function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms)) return NON_FINITE_PLACEHOLDER
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 'YYYY-MM-DD' -> 'MM-DD'. */
export function formatDay(day: string): string {
  return day.length >= 10 ? day.slice(5) : day
}

/**
 * 整份账（同一个行集）**一行都没定价**：`totalCny === 0` 且存在未收录模型。
 *
 * 这是全应用**唯一**的「金额 0 是假的」判据（review fix round 2 之前，入口卡、
 * 概览、趋势、明细各自判一遍，于是同一个状态在同一个 app 里读出两种结果）。
 * 契约（已与入口卡的既有行为对齐并两侧钉住）：
 * - `'—'`：`totalCny === 0 && unpricedModels.length > 0` —— 有记录、但一条都没算钱；
 * - `¥0.00`：**真实零** —— 账本完全没有用量（calls === 0），或用量已计价而合计确为 0。
 *
 * `unpricedModels` 允许 undefined：远程 codec 是宽松透传（形状校验在 host），
 * 旧 host 的响应可能没有这个字段，此时按「没有未收录模型」处理（即真实零）。
 */
export function isUnpricedTotal(
  totalCny: number,
  unpricedModels: readonly unknown[] | undefined,
): boolean {
  return totalCny === 0 && (unpricedModels?.length ?? 0) > 0
}

/**
 * 回填披露的取值规则（与金额**同源**，绝不靠二次取数推断）：
 * 标记由承载金额的那份 payload 一起带回；标记缺席（旧 host、宽松 codec 透传，
 * 或响应根本没能产出）时一律按 **present** 处理 —— 宁多披露，绝不少披露。
 */
export function backfilledDisclosure(flag: boolean | undefined): boolean {
  return flag !== false
}
