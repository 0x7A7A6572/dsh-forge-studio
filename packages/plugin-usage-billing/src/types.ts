/**
 * usage-billing 共享类型（host 与 client 共用）。这里**除唯一的常量**外只有类型，
 * client 对它们一律 type-only import；`USAGE_BILLING_NAMESPACE` 是零依赖的运行时值，
 * client 必须 value-import（见 client/index.ts —— 从 settings.ts 取值会把 host 实现拖进浏览器产物）。
 */

import type { Tier, TierDayProfile } from './pricing/tiers.ts'

/** 计价所用单价的原生币种。 */
export type Currency = 'CNY' | 'USD'

/** 旧配置里的入口落点（二选一）；已被两个独立开关取代，只在开关缺席时被翻译。 */
export type EntryPosition = 'sidebar' | 'composer'

/** 入口开关的键：两个入口各自独立，可只开一处、也可两处都开。 */
export type EntryKey = 'sidebar' | 'composer'

/** 一条模型单价（每百万 token）。 */
export interface PriceEntry {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  currency: Currency
}

/** 峰谷状态（宿主算好下发；客户端不引节假日库）。 */
export interface TierStatus {
  /** 此刻档位；null = 分时价尚未启用。 */
  current: Tier | null
  /** 下次档位切换时刻；null = 近期不变。 */
  nextSwitchAt: number | null
  /** 有节假日数据的最后一年（界面据此提示）。 */
  holidayDataThrough: number
  /** 今日费率形状（曲线的数据源）；旧宿主没有这个字段、规则未生效时为 null → 都不画曲线。 */
  day?: TierDayProfile | null
}

/** 时间范围：闭区间毫秒时间戳；null 表示不限。 */
export interface RangeSpec {
  since: number | null
  until: number | null
}

/** 主账本一行 —— 一次带 usage 的模型调用，金额写时锁定。 */
export interface LedgerRow {
  /** `ledgerKey(sessionId, seq)`（`<sessionId>__<seq>`，见 `storage-key.ts`）—— 天然幂等键。 */
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
  /** 计费档位；峰谷上线之前写下的行没有这个字段（= 单档）。 */
  tier?: Tier
  /** time < installAt。 */
  backfilled: boolean
}

/**
 * 账本分片：一个 (会话, 天) 的全部账本行（键 = `ledgerShardKey(sessionId, day)`）。
 *
 * 行身份仍是 `LedgerRow.id`，分片只是容器 —— 因此「重复折叠不重复计费」由
 * 「分片内 id 唯一」保证，不再由存储键唯一保证（见 `shard-merge.ts`）。
 */
export interface LedgerShard {
  /** 分片记录自身的格式版本（与 domain 的 version 无关）；将来加字段时用它区分。 */
  v: number
  sessionId: string
  /** 'YYYY-MM-DD'，与 `LedgerRow.day` 同源。 */
  day: string
  rows: LedgerRow[]
}

/** 每会话折叠水位。 */
export interface FoldState {
  sessionId: string
  /**
   * 折叠时的会话变更戳（`sessionPersistence` 的 revision）—— **跳过判定的唯一依据**。
   * 旧记录没有这个字段：首轮必然重折一次，随后补上（自愈，不需要迁移）。
   */
  stamp?: string
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
  /**
   * `aliasId(provider, rawModel)`：provider 去空格 + 小写、rawModel 去空格，
   * 再由 `storage-key.ts` 编码成路径安全键（`<provider>__<rawModel>`）。
   */
  id: string
  provider: string
  rawModel: string
  canonicalModel: string
}

/**
 * 诊断条目（会话损坏 / 联网失败 / 投影失败）。
 *
 * id 稳定于 `(sessionId, kind)`：同一故障反复出现只累加 `count`、刷新 `lastAt` 与 `detail`，
 * 不再是「每次失败一个新键」的追加流（那会无界增长）。
 */
export interface Diagnostic {
  id: string
  /** 首次出现的时刻。 */
  at: number
  /** 最近一次出现的时刻；旧记录（稳定键之前落盘）缺省为 0，读时按 `at` 处理。 */
  lastAt: number
  /** 累计出现次数；旧记录缺省为 1。 */
  count: number
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

/**
 * 域的全局标记（per-record 布局里的 `global.json`，随域打开一起读出）。
 *
 * 为什么用全局槽而不是另开一个域：账本要不要重建，必须在**打开域之前**就有答案；
 * 全局槽本来就跟本次 open 一起读，省掉第二个域的开关次序与竞态。
 */
export interface DomainMeta {
  /** 账本分片重建完成的时刻；缺省 = 从未重建过（下次启动会从头来一趟）。 */
  rebuiltAt?: number
  /** 重建后的行数 / 分片数；只做诊断与验收，不参与判定。 */
  rebuiltRows?: number
  rebuiltShards?: number
}

/**
 * 设置命名空间名：dsh 0.1.7 起 = 本插件在 profile 里的条目 id（cordis.patch.yml 的
 * `id: usage-billing-zzerx`），不再是自取的字符串命名空间。
 */
export const USAGE_BILLING_NAMESPACE = 'usage-billing-zzerx'
