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
