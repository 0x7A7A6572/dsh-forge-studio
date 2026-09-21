/**
 * 抢救被截断的 JSON：截断点之前的内容仍然完整，只是缺收尾括号。
 *
 * 宿主按 maxBodyChars 砍响应体，models.dev 的 api.json 是它的几十倍 ——
 * 「整次失败」安全但等于永不更新，所以在**只增不删**的前提下抢救前缀来用。
 */

/** 顶层容器的收尾字符；不是对象/数组就不救。 */
function rootCloser(text: string): string | null {
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') continue
    if (ch === '{') return '}'
    if (ch === '[') return ']'
    return null
  }
  return null
}

/**
 * 把被砍掉尾巴的 JSON 补成合法文档；救不出来返回 null。
 *
 * 只认「顶层最后一个完整成员」这个边界：那里的值都写得完整，
 * 半截成员（残缺的数字或字符串）整条丢弃 —— 绝不猜价。
 * @param text - 宿主砍过的响应体。
 */
export function salvageJsonPrefix(text: string): string | null {
  const closer = rootCloser(text)
  if (closer === null) return null
  let inString = false
  let escaped = false
  let depth = 0
  let cut = -1
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') { depth += 1; continue }
    if (ch === '}' || ch === ']') { depth -= 1; continue }
    // 顶层逗号 = 两个完整成员之间的边界。
    if (ch === ',' && depth === 1) cut = i
  }
  if (cut < 0) return null
  return text.slice(0, cut) + closer
}
