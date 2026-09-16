/**
 * usage-billing 共享类型（host 与 client 共用）。这里**除唯一的常量**外只有类型，
 * client 对它们一律 type-only import；`USAGE_BILLING_NAMESPACE` 是零依赖的运行时值，
 * client 必须 value-import（见 client/index.ts —— 从 settings.ts 取值会把 host 实现拖进浏览器产物）。
 */

/** 计价所用单价的原生币种。 */
export type Currency = 'CNY' | 'USD'

/** 一条模型单价（每百万 token）。 */
export interface PriceEntry {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  currency: Currency
}

/** 时间范围：闭区间毫秒时间戳；null 表示不限。 */
export interface RangeSpec {
  since: number | null
  until: number | null
}

/** 主账本一行 —— 一次带 usage 的模型调用，金额写时锁定。 */
export interface LedgerRow {
  /** `${sessionId}#${seq}` —— 天然幂等键。 */
  id: string
  sessionId: string
  seq: number
  time: number
  /** 原始 provider / 原始 model id（别名只在展示层应用）。 */
  provider: string
  model: string
  /** 'YYYY-MM-DD'（本机时区）。 */
  day: string
  cwd?: string
  isSubagent: boolean
  delegationDepth?: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning: number
  /** 已折算为人民币的锁定金额。 */
  costCny: number
  currency: Currency
  priced: boolean
  /** 计价所用的价表快照 id（可追溯）。 */
  snapshotId: string
  /** time < installAt。 */
  backfilled: boolean
}

/** 每会话折叠水位。 */
export interface FoldState {
  sessionId: string
  foldedThroughSeq: number
  lastTime: number
  headerCreatedAt: number
  lastSnapshotId: string
}

/** 价表快照：一条 base 全量 + 后续 delta 差量，只追加。 */
export interface PriceSnapshot {
  id: string
  at: number
  kind: 'base' | 'delta'
  reason: 'install' | 'catalog-refresh' | 'custom-price' | 'manual-refresh'
  usdToCny: number
  usdToCnySource: 'live' | 'default'
  entries: Record<string, PriceEntry>
  removed?: string[]
}

/** 手工别名绑定（可撤销）。 */
export interface ModelAlias {
  /** `aliasId(provider, rawModel)`：provider 去空格 + 小写、rawModel 去空格，NUL 分隔。 */
  id: string
  provider: string
  rawModel: string
  canonicalModel: string
}

/** 诊断条目（会话损坏 / 联网失败 / 投影失败）。 */
export interface Diagnostic {
  id: string
  at: number
  kind: 'session-read' | 'pricing-fetch' | 'projection'
  detail: string
}

/** 自定义单价写入。 */
export interface CustomPriceInput {
  provider: string
  model: string
  currency: Currency
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** 手工别名写入；canonicalModel 为 null 表示解绑。 */
export interface AliasInput {
  provider: string
  rawModel: string
  canonicalModel: string | null
}

/** 设置命名空间名。 */
export const USAGE_BILLING_NAMESPACE = 'forge-studio-usage-billing'
