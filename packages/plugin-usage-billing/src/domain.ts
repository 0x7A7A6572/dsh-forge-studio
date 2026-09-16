/**
 * usage-billing storage domain：ledger（主账本）/ folds（水位）/ snapshots（价表快照）
 * / aliases（手工别名）/ diag（诊断）五表，per-record 布局。
 * 数据持久化只走 ctx.storage 之上的 storage-domain，不自造。
 *
 * ⚠️ per-record 布局把**键**当文件路径的一段，只接受 `/^[a-zA-Z0-9_-]+$/`，不匹配的键
 * 在写入时直接被拒。所以五张表的键一律由 `storage-key.ts` 产出，任何调用点都不得自己拼键。
 */

import type { ZodType } from 'zod'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  Diagnostic, FoldState, LedgerRow, ModelAlias, PriceSnapshot,
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

/** usage-billing 域。 */
export const usageBillingDomain = defineDomain({
  name: 'usage_billing',
  version: 1,
  layout: 'per-record',
  tables: {
    ledger: domainTable<string, LedgerRow>(ledgerRowSchema),
    folds: domainTable<string, FoldState>(foldStateSchema),
    snapshots: domainTable<string, PriceSnapshot>(priceSnapshotSchema),
    aliases: domainTable<string, ModelAlias>(modelAliasSchema),
    diag: domainTable<string, Diagnostic>(diagnosticSchema),
  },
})
