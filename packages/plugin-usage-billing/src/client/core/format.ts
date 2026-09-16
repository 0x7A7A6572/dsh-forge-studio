/** 展示格式化（纯函数）。金额一律人民币、千分位、**不缩写**（spec §7.3）。 */

function thousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatCny(n: number): string {
  if (!Number.isFinite(n)) return '¥0.00'
  if (Math.abs(n) < 0.01) return n === 0 ? '¥0.00' : '<¥0.01'
  const fixed = Math.abs(n).toFixed(2)
  const [int = '0', frac = '00'] = fixed.split('.')
  return `${n < 0 ? '-' : ''}¥${thousands(int)}.${frac}`
}

export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const rounded = Math.round(n)
  return `${rounded < 0 ? '-' : ''}${thousands(String(Math.abs(rounded)))}`
}

export function formatPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '0.0%'
  return `${(n * 100).toFixed(digits)}%`
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 'YYYY-MM-DD' → 'MM-DD'。 */
export function formatDay(day: string): string {
  return day.length >= 10 ? day.slice(5) : day
}
