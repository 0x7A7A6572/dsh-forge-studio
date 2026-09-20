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

/**
 * 短日期时间：同年省年份（9-25 17:00），跨年补全（2027-1-3 09:00）。
 * 定时摘要行 / 泳道卡这类窄地方用它，完整时刻仍走 fmtDateTime 放 title。
 */
export function fmtShortDateTime(ts: number, now: number = Date.now()): string {
  const d = new Date(ts)
  const md = `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}-${md}`
}

/**
 * 距目标时刻还有多久（中文）：即将 / N 分钟后 / N 小时后 / N 天后；已过点 → 已过期。
 * 只用于「下次触发」这类未来时间戳，与 fmtRelative（过去时间）成对，永不抛错。
 */
export function fmtCountdown(ts: number, now: number = Date.now()): string {
  const diff = ts - now
  if (diff <= 0) return '已过期'
  if (diff < 60_000) return '即将'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟后`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时后`
  return `${Math.floor(hours / 24)} 天后`
}

/**
 * 执行耗时（运行中任务相对 startedAt 的已耗时）：毫秒 → 中文时长。
 * 负值按 0 处理，永不抛错。用于泳道 running 卡的 elapsed 文本。
 */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem > 0 ? `${hours} 小时 ${rem} 分钟` : `${hours} 小时`
}
