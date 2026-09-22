/**
 * usage-billing storage domain：ledger_shards（主账本，按会话×天分片）/ folds（水位）
 * / snapshots（价表快照）/ aliases（手工别名）/ diag（诊断）五表，per-record 布局。
 * 数据持久化只走 ctx.storage 之上的 storage-domain，不自造。
 *
 * ⚠️ per-record 布局把**键**当文件路径的一段，只接受 `/^[a-zA-Z0-9_-]+$/`，不匹配的键
 * 在写入时直接被拒。所以五张表的键一律由 `storage-key.ts` 产出，任何调用点都不得自己拼键。
 * ⚠️ 表名另受 `/^[a-z][a-z0-9_]*$/` 约束（defineDomain 在模块加载时直接抛），
 * 所以是 `ledger_shards`，不是驼峰。
 */

import type { ZodType } from 'zod'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  Diagnostic, DomainMeta, FoldState, LedgerRow, LedgerShard, ModelAlias, PriceSnapshot,
} from './types.ts'

/** 主账本行：只增不改（未计价行重算除外）。`.passthrough()` 保留未知键以兼容升级。 */
export const ledgerRowSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number(),
  time: z.number(),
  provider: z.string(),
  model: z.string(),
  day: z.string(),
  cwd: z.string().optional(),
  isSubagent: z.boolean(),
  delegationDepth: z.number().optional(),
  input: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  reasoning: z.number(),
  costCny: z.number(),
  currency: z.enum(['CNY', 'USD']),
  priced: z.boolean(),
  snapshotId: z.string(),
  backfilled: z.boolean(),
}).passthrough() as unknown as ZodType<LedgerRow>

/**
 * 账本分片记录：一个 (会话, 天) 的全部账本行（键 = \`ledgerShardKey(sessionId, day)\`）。
 *
 * 行本身一个字没改（身份仍是 \`id\`），换掉的只是容器：per-record 布局一行一文件时
 * 两万行就是两万次文件打开（冷启动实测 35.7s），按会话×天收成 373 条后降到 0.68s。
 * \`.passthrough()\` 与行同一理由：升级时旧记录多出的字段不能被判成坏记录。
 */
export const ledgerShardSchema = z.object({
  v: z.number(),
  sessionId: z.string(),
  day: z.string(),
  rows: z.array(ledgerRowSchema),
}).passthrough() as unknown as ZodType<LedgerShard>

/** 每会话水位。 */
export const foldStateSchema = z.object({
  sessionId: z.string(),
  /** 会话变更戳；旧记录缺失 → 首轮重折一次后补上（不需要迁移）。 */
  stamp: z.string().optional(),
  foldedThroughSeq: z.number(),
  lastTime: z.number(),
  headerCreatedAt: z.number(),
  lastSnapshotId: z.string(),
}) as unknown as ZodType<FoldState>

/** 价表快照（base + delta，只追加）。 */
export const priceSnapshotSchema = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.enum(['base', 'delta']),
  reason: z.enum(['install', 'catalog-refresh', 'custom-price', 'manual-refresh']),
  usdToCny: z.number(),
  usdToCnySource: z.enum(['live', 'default']),
  entries: z.record(z.string(), z.object({
    input: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    output: z.number(),
    currency: z.enum(['CNY', 'USD']),
  })),
  removed: z.array(z.string()).optional(),
}) as unknown as ZodType<PriceSnapshot>

/** 手工别名绑定。 */
export const modelAliasSchema = z.object({
  id: z.string(),
  provider: z.string(),
  rawModel: z.string(),
  canonicalModel: z.string(),
}) as unknown as ZodType<ModelAlias>

/**
 * 诊断条目。
 *
 * `lastAt` / `count` 用 zod `.default()` 而不是必填：稳定键之前落盘的老记录只有
 * `{id, at, kind, detail}`，而 storage-domain 在 open() 时对**每条**记录跑 schema.parse，
 * 缺必填字段会让整条记录（乃至整个域）读失败。默认值只在「老记录」上生效，
 * 新记录一律由 `recordDiagnostic` 显式写全。
 */
export const diagnosticSchema = z.object({
  id: z.string(),
  at: z.number(),
  lastAt: z.number().default(0),
  count: z.number().default(1),
  kind: z.enum(['session-read', 'pricing-fetch', 'projection']),
  detail: z.string(),
}) as unknown as ZodType<Diagnostic>

/**
 * 域全局标记：账本分片是否已经重建过（见 `service.rebuildLedger`）。
 * 字段全可选，所以初始值 `{}` 合法；`passthrough` 与表同理由。
 */
export const domainMetaSchema = z.object({
  rebuiltAt: z.number().optional(),
  rebuiltRows: z.number().optional(),
  rebuiltShards: z.number().optional(),
}).passthrough() as unknown as ZodType<DomainMeta>

/** usage-billing 域。 */
export const usageBillingDomain = defineDomain({
  name: 'usage_billing',
  version: 1,
  layout: 'per-record',
  // `initial` 显式标类型：不标的话 TS 从 `{}` 推全局类型，`domain.global.get()` 会退化成 `{}`。
  global: { schema: domainMetaSchema, initial: {} as DomainMeta },
  tables: {
    // 旧的 `ledger`（一行一文件）**已除名**：只要不在这里声明，loadAll 就不会去读
    // 那个目录（实测：两万多个旧文件留在盘上不影响 open），旧数据因此天然可回滚。
    ledger_shards: domainTable<string, LedgerShard>(ledgerShardSchema),
    folds: domainTable<string, FoldState>(foldStateSchema),
    snapshots: domainTable<string, PriceSnapshot>(priceSnapshotSchema),
    aliases: domainTable<string, ModelAlias>(modelAliasSchema),
    diag: domainTable<string, Diagnostic>(diagnosticSchema),
  },
})
