/**
 * usage_billing 假表（全套用例共用的**唯一**测试替身）。
 *
 * 为什么要有这个文件：真实后端（`@deepseek-ai/dsh-storage-json` 的 per-record 布局）
 * 把记录键直接当文件路径的一段，只接受 `/^[a-zA-Z0-9_-]+$/` —— 不匹配时 **putRecord /
 * deleteRecord / backupRecord 抛错**（读路径宽容放行）。此前每个测试文件各抄一份
 * 「纯 Map」假表，从不校验键，于是 `${sessionId}#${seq}` / NUL 分隔的别名键 /
 * `${prevId}#delta` 这类非法键在 303 个绿灯用例下畅通无阻，到真实运行时全量写失败。
 *
 * 所以这里的校验**照抄真实规则**（正则、报错文案、只卡写路径），键一非法立刻红。
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SAFE_KEY_RE } from '../src/storage-key.ts'

/**
 * 复刻后端的键校验（报错文案与 per-record-unit.ts 的 assertSafeKey 逐字一致）。
 * @param unit - 域名（真实后端报错里带的单位名）。
 * @param key - 记录键；会被当成路径的一段。
 */
export function assertSafeKey(unit: string, key: string): void {
  if (!SAFE_KEY_RE.test(key)) {
    throw new Error(`unit '${unit}': per-record key '${key}' is not path-safe (must match ${SAFE_KEY_RE})`)
  }
}

/**
 * 一张假表：写路径（put / delete / update）拒绝非法键，读路径（get / entries / size）
 * 与真实后端一样宽容 —— 键的问题必须在**写**的时候暴露，而不是读的时候。
 * @param unit - 域名，仅用于报错文案。
 * @returns 一个与 KvTable 同形的内存表。
 */
export function fakeTable<V>(unit = 'usage_billing'): KvTable<string, V> {
  const map = new Map<string, V>()
  return {
    get: (key) => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    get size() { return map.size },
    put: async (key, value) => {
      assertSafeKey(unit, key)
      map.set(key, value)
    },
    delete: async (key) => {
      assertSafeKey(unit, key)
      return map.delete(key)
    },
    update: async (key, fn) => {
      assertSafeKey(unit, key)
      const current = map.get(key)
      if (current === undefined) throw new Error('missing-key')
      const next = fn(current)
      map.set(key, next)
      return next
    },
  }
}
