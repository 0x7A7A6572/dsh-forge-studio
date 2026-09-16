/**
 * 模型 key 规范化与查价档位（纯函数）。
 *
 * 关键设计（spec §5.5）：**账本永远存原始 provider + 原始 model id**，别名只在
 * 展示层与查价时使用。所以这里只产出「查价候选序列」，不改写任何落盘数据。
 *
 * 内置规则只做**确定性的字符串归一**（剥组织前缀、剥日期后缀、小写化），
 * 不做「猜同款模型」的映射 —— 那类映射只能由用户手工绑定（见 Task 16）。
 */

import type { ModelAlias } from './types.ts'

export const WILDCARD = '*'

/** 手工别名的存储键（用 NUL 分隔，避免与 id 里的斜杠混淆）。 */
export function aliasId(provider: string, rawModel: string): string {
  return `${provider.trim().toLowerCase()}\u0000${rawModel}`
}

const DATE_SUFFIX = /-(?:\d{8}|\d{6}|\d{4}-\d{2})$/
const ORG_PREFIX = /^[a-z0-9][a-z0-9._-]*\//

/** 确定性归一：小写去空格 → 剥组织前缀 → 剥日期后缀。 */
export function normalizeModelId(raw: string): string {
  let id = raw.trim().toLowerCase()
  id = id.replace(ORG_PREFIX, '')
  id = id.replace(DATE_SUFFIX, '')
  return id
}

/**
 * 查价候选（按优先级）：原始 → 规范化 → 手工别名 → provider 兜底 → 全局兜底。
 * 去重保序（原始 id 已规范时两者相同，只保留一个）。
 */
export function priceKeyCandidates(provider: string, rawModel: string, alias?: ModelAlias): string[] {
  const p = provider.trim().toLowerCase()
  const raw = rawModel.trim()
  const normalized = normalizeModelId(raw)
  const out = [`${p}/${raw}`, `${p}/${normalized}`]
  if (alias !== undefined && alias.canonicalModel !== '') {
    out.push(`${p}/${alias.canonicalModel}`)
  }
  out.push(`${p}/${WILDCARD}`, `${WILDCARD}/${WILDCARD}`)
  return [...new Set(out)]
}
