/**
 * 纯文本 / 时间格式化：视图与 hook 共用，不碰 DOM、不 import react。
 */

/** 错误对象 → 可展示文本。 */
export function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

/** 时间戳 → 本地 `YYYY-MM-DD HH:mm`。 */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 报告时间范围：`since ~ until`（无 until 时只显示 since）。 */
export function formatDateRange(since: string, until: string | undefined): string {
  return until === undefined ? since : since + ' ~ ' + until
}
