/**
 * 内置价表（USD/CNY 每百万 token，**原生币种存储**：国内厂商直接录人民币，
 * 国外录美元，计价时按快照汇率折算）。
 *
 * ⚠️ 数值是「可用的起点」，不是权威价：Task 14 会用 models.dev 的实时目录覆盖同名 key，
 * 覆盖失败时回落到这里。UI 上以「内置价」徽标标注来源（见 spec §6.5）。
 * 新增模型请优先在 models.dev 目录里确认后再补，不要凭印象编价。
 */

import type { PriceEntry } from '../types.ts'

/** 内置兜底汇率（Task 14 联网失败时使用）。 */
export const DEFAULT_USD_TO_CNY = 7.1

/** 统一 key：`provider/model`，provider 去空格转小写。 */
export function priceKey(provider: string, model: string): string {
  return `${provider.trim().toLowerCase()}/${model.trim()}`
}

/** 冻结单条价目：只浅冻结外层 record 挡不住 `catalog[k].input = x` 这类就地改写。 */
const entry = (e: PriceEntry): PriceEntry => Object.freeze({ ...e })

/** 内置价表：DeepSeek 官方全系 + 少量常用对照项。 */
export const BUILTIN_CATALOG: Readonly<Record<string, PriceEntry>> = Object.freeze({
  // —— DeepSeek 官方（CNY / 百万 token）——
  'deepseek/deepseek-v4-flash': entry({ input: 0.5, cacheRead: 0.1, cacheWrite: 0.5, output: 2, currency: 'CNY' }),
  'deepseek/deepseek-v4-pro': entry({ input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8, currency: 'CNY' }),
  'deepseek/deepseek-chat': entry({ input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8, currency: 'CNY' }),
  'deepseek/deepseek-reasoner': entry({ input: 4, cacheRead: 1, cacheWrite: 4, output: 16, currency: 'CNY' }),
  // —— 国外厂商对照（USD / 百万 token）——
  'openai/gpt-4o-mini': entry({ input: 0.15, cacheRead: 0.075, cacheWrite: 0.15, output: 0.6, currency: 'USD' }),
  'openai/gpt-4o': entry({ input: 2.5, cacheRead: 1.25, cacheWrite: 2.5, output: 10, currency: 'USD' }),
  'anthropic/claude-sonnet-4': entry({ input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15, currency: 'USD' }),
})
