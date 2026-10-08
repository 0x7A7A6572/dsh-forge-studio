import type { Tier, TierDayProfile } from './pricing/tiers.ts'

export type Currency = 'CNY' | 'USD'

/** 旧配置落点：已被两个入口开关取代，仅在开关缺席时被翻译。 */
export type EntryPosition = 'sidebar' | 'composer'

export type EntryKey = 'sidebar' | 'composer'

/** 每百万 token 的单价。 */
export interface PriceEntry {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  currency: Currency
}

export interface TierStatus {
  /** null = 分时价尚未启用。 */
  current: Tier | null
  /** null = 近期不变。 */
  nextSwitchAt: number | null
  holidayDataThrough: number
  /** 今日费率形状（曲线数据源）；null = 旧宿主或规则未生效，不画曲线。 */
  day?: TierDayProfile | null
}

/** 闭区间毫秒时间戳；null = 不限。 */
export interface RangeSpec {
  since: number | null
  until: number | null
}

/** 一次带 usage 的模型调用；金额写时锁定。 */
export interface LedgerRow {
  /** 幂等键：`<sessionId>__<seq>`（`ledgerKey`）。 */
  id: string
  sessionId: string
  seq: number
  time: number
  /** 原始 provider / model id；别名只在展示层应用。 */
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
  costCny: number
  currency: Currency
  priced: boolean
  snapshotId: string
  /** 缺席 = 峰谷上线前写下的行（单档）。 */
  tier?: Tier
  /** time < installAt。 */
  backfilled: boolean
}

/** 一个 (会话, 天) 的账本行；不重复计费由分片内 id 唯一保证，不由存储键。 */
export interface LedgerShard {
  /** 分片自身的格式版本；与 domain 的 version 无关。 */
  v: number
  sessionId: string
  day: string
  rows: LedgerRow[]
}

export interface FoldState {
  sessionId: string
  /** `sessionPersistence` 的 revision；缺席 = 旧记录，首轮会重折一次。 */
  stamp?: string
  foldedThroughSeq: number
  lastTime: number
  headerCreatedAt: number
  lastSnapshotId: string
}

/** base 全量 + 后续 delta 差量，只追加。 */
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

export interface ModelAlias {
  id: string
  provider: string
  rawModel: string
  canonicalModel: string
}

/** 诊断条目；id 稳定于 `(sessionId, kind)`，同一故障只累加 count。 */
export interface Diagnostic {
  id: string
  /** 首次出现的时刻。 */
  at: number
  /** 最近一次出现；旧记录缺省 0，读时按 `at` 处理。 */
  lastAt: number
  /** 累计出现次数；旧记录缺省为 1。 */
  count: number
  kind: 'session-read' | 'pricing-fetch' | 'projection'
  detail: string
}

export interface CustomPriceInput {
  provider: string
  model: string
  currency: Currency
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** canonicalModel 为 null = 解绑。 */
export interface AliasInput {
  provider: string
  rawModel: string
  canonicalModel: string | null
}

/** `global.json` 里的全局槽，随域打开一起读出。 */
export interface DomainMeta {
  /** 缺省 = 从未重建过（下次启动会重来一趟）。 */
  rebuiltAt?: number
  /** 只做诊断与验收，不参与判定。 */
  rebuiltRows?: number
  rebuiltShards?: number
}

/** = profile 条目 id，须与 `cordis.patch.yml` 的 id 一致。 */
export const USAGE_BILLING_NAMESPACE = 'usage-billing-zzerx'
