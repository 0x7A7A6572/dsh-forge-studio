/**
 * 时间显示工具：卡片行用相对时间，tooltip 用完整时间。
 */

const pad = (n: number): string => String(n).padStart(2, '0')

/** 完整日期时间：2025-01-02 03:04 */
export function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 仅日期：2025-01-02 */
function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 相对时间（中文）：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前（7 天内）/ 具体日期。
 * 未来时间戳按“刚刚”处理，永不抛错。
 */
export function fmtRelative(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return fmtDate(ts)
}
