/**
 * 模型 key 规范化与查价档位（纯函数）。
 *
 * 关键设计（spec §5.5）：**账本永远存原始 provider + 原始 model id**，别名只在
 * 展示层与查价时使用。所以这里只产出「查价候选序列」，不改写任何落盘数据。
 *
 * 内置规则只做**确定性的归一**：剥组织前缀、剥日期后缀、小写化，外加一张「同款异名」表
 * （见 MODEL_SYNONYMS）。不做模糊猜 —— 猜错就是把贵的那档算成便宜的；表里没写的仍由用户
 * 手工绑定（手工别名优先）。
 */

import { aliasKey } from './storage-key.ts'
import type { ModelAlias } from './types.ts'

export const WILDCARD = '*'

/** provider 归一化：去空格 + 小写（aliasId 与查价候选共用同一份规则）。 */
function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase()
}

/**
 * 手工别名的存储键。
 *
 * 编码由 `storage-key.ts` 独占：旧实现用 NUL 分隔（`${provider}\u0000${rawModel}`），
 * 在真实 per-record 后端上不是路径安全键，**每一次别名写入都被拒绝**（单测的假表不校验，
 * 所以一直没暴露）。这里只负责两侧归一化，然后交给统一的编码器。
 */
export function aliasId(provider: string, rawModel: string): string {
  return aliasKey(normalizeProvider(provider), rawModel.trim())
}

const DATE_SUFFIX = /-(?:\d{8}|\d{6}|\d{4}-\d{2})$/
const ORG_PREFIX = /^[a-z0-9][a-z0-9._-]*\//

/**
 * 内置「同款异名」表：键与值都是**归一化后**的模型名。
 *
 * 只写确定是同一个模型的（同价、同参数）。官方 API 名 `deepseek-flash` 与目录名
 * `deepseek-v4-flash` 就是同一个模型；写进这里，历史价表（可能只有其中一个名字）
 * 也能命中，不必再让用户手工绑别名。
 */
const MODEL_SYNONYMS: Readonly<Record<string, string>> = {
  'deepseek-flash': 'deepseek-v4-flash',
}

/** 同款异名归到目录名；不在表里原样返回。 */
function canonicalModelName(name: string): string {
  return MODEL_SYNONYMS[name] ?? name
}

/** 确定性归一：小写去空格 → 剥组织前缀 → 剥日期后缀 → 同款异名归一到目录名。 */
export function normalizeModelId(raw: string): string {
  let id = raw.trim().toLowerCase()
  id = id.replace(ORG_PREFIX, '')
  id = id.replace(DATE_SUFFIX, '')
  return canonicalModelName(id)
}

/**
 * 「同名」判据（**展示层分组**用）：小写去空格 + 剥组织前缀，**不剥日期后缀**。
 *
 * 与 `normalizeModelId` 的差别是有意的：`claude-...-20240620` 与 `-20241022` 是不同版本、
 * 单价也不同，并成一行会让金额失真；而 `openrouter/deepseek/deepseek-chat` 与
 * `deepseek/deepseek-chat` 就是同一个模型名，必须落在同一行。
 * 只做确定性归一 + 内置等价表，不猜"同款模型"。账本仍存原始 provider + 原始 model，没有任何改写。
 */
export function sameModelName(raw: string): string {
  return canonicalModelName(raw.trim().toLowerCase().replace(ORG_PREFIX, ''))
}

/**
 * 查价候选（按优先级）：
 *
 * 1. `<provider>/<原始 id>` —— 完全命中
 * 2. `<provider>/<规范化 id>` —— 同 provider 下按规范化名字命中（剥组织前缀 / 日期后缀）
 * 3. `<provider>/<别名 canonical>` —— 手工绑定
 * 4. `*`/`<canonical>`、`*`/`<规范化>`、`*`/`<原始>` —— **同名兜底（跨 provider）**
 * 5. `<provider>`/`*` —— provider 兜底
 * 6. `*`/`*` —— 全局兜底
 *
 * 第 4 档是「同名模型就是同一个模型」的落点：经中转渠道（`ds-hk` / `modlens-ds-hk` / `openrouter`…）
 * 调官方模型时，provider 前缀在目录里根本不存在，只有**模型名**能对上内置目录价 ——
 * 少了这一档，这些行永远显示「未收录」。`priceUsage` 把首段为 `*` 的候选解释成
 * 「任何 provider 下叫这个名字的价」。
 *
 * 顺序是有意的：名字命中比「这个 provider 下随便什么模型」（`<provider>/*`）更具体，
 * 所以同名兜底排在 provider 兜底之前；任何一档都能被更靠前的一档覆盖（给
 * `ds-hk/deepseek-v4-flash` 写一条自定义价即回到第 1 档命中）。
 * 去重保序（原始 id 已规范时两者相同，只保留一个）。
 */
export function priceKeyCandidates(provider: string, rawModel: string, alias?: ModelAlias): string[] {
  const p = normalizeProvider(provider)
  const raw = rawModel.trim()
  const normalized = normalizeModelId(raw)
  const out = [`${p}/${raw}`, `${p}/${normalized}`]
  if (alias !== undefined && alias.canonicalModel !== '') {
    out.push(`${p}/${alias.canonicalModel}`, `${WILDCARD}/${normalizeModelId(alias.canonicalModel)}`)
  }
  out.push(`${WILDCARD}/${normalized}`, `${WILDCARD}/${raw}`)
  out.push(`${p}/${WILDCARD}`, `${WILDCARD}/${WILDCARD}`)
  return [...new Set(out)]
}
