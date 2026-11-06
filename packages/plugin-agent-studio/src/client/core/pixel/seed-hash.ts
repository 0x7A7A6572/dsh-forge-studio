/**
 * 确定性哈希与伪随机（§6.6）：纯函数、零依赖、跨浏览器一致。
 */

/** FNV-1a 32 位哈希；空串返回初始偏移量。 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** xorshift32；state 为 0 时是固定点恒返回 0，调用方须避免传入 0 状态。 */
export function xorshift32(state: number): number {
  let x = state | 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

/** 取 [0, max) 的下一个伪随机数，并返回新状态供链式调用；max 必须为正整数。 */
export function nextInt(state: number, max: number): { value: number; state: number } {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error(`nextInt max must be a positive integer, got ${max}`)
  }
  const next = xorshift32(state)
  return { value: next % max, state: next }
}
