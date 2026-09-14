/**
 * memory storage domain 声明：identity、格式版本与 zod 记录 schema。
 * 三张表（per-record 布局）：memories 记忆条目、raw_documents 原文留档、
 * audits 后台模型调用审计。数据持久化只走 ctx.storage（storage-json）之上的
 * storage-domain，不自造持久化。
 */

import type { ZodType } from 'zod'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { MEMORY_KINDS, MEMORY_SCOPES } from './types.ts'
import type {
  MemoryAuditEntry, MemoryId, MemoryRawDocument, MemoryRawId, MemoryRecord,
} from './types.ts'

/**
 * 记忆记录 schema（存储边界校验）。旧记录缺省字段由 default 补齐：
 * scope 缺省 global、projectPath 缺省空串、importance 缺省 3，
 * 因此升级前的记录无需迁移即可读入。
 */
export const memoryRecordSchema = z.object({
  id: z.string(),
  kind: z.enum(MEMORY_KINDS).default('fact'),
  scope: z.enum(MEMORY_SCOPES).default('global'),
  projectPath: z.string().default(''),
  title: z.string(),
  content: z.string(),
  importance: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
  source: z.string().default('agent'),
  sessionId: z.string().optional(),
}) as unknown as ZodType<MemoryRecord>

/**
 * 原文留档 schema：摄取管线的第一段。表是后加的（同一 domain 内新增表不影响
 * 已存文档，version 不变），旧的 memories 记录照常读入。
 */
export const rawDocumentSchema = z.object({
  id: z.string(),
  origin: z.string().default('import'),
  scope: z.enum(MEMORY_SCOPES).default('global'),
  projectPath: z.string().default(''),
  title: z.string().default(''),
  text: z.string().default(''),
  textLength: z.number().default(0),
  createdAt: z.number(),
  updatedAt: z.number().default(0),
  extractedAt: z.number().optional(),
  recordIds: z.array(z.string()).default([]),
  sessionId: z.string().optional(),
  note: z.string().optional(),
}) as unknown as ZodType<MemoryRawDocument>

/** 后台模型调用审计 schema（路线图 #5）。 */
export const auditEntrySchema = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.string(),
  provider: z.string().default(''),
  model: z.string().default(''),
  ok: z.boolean().default(true),
  durationMs: z.number().default(0),
  inputChars: z.number().default(0),
  outputChars: z.number().default(0),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  recordIds: z.array(z.string()).default([]),
  rawId: z.string().optional(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
}) as unknown as ZodType<MemoryAuditEntry>

/** memory 域：memories（记忆条目）+ raw_documents（原文留档）+ audits（模型调用审计）。 */
export const memoryDomain = defineDomain({
  name: 'memory',
  version: 1,
  layout: 'per-record',
  tables: {
    memories: domainTable<MemoryId, MemoryRecord>(memoryRecordSchema),
    raw_documents: domainTable<MemoryRawId, MemoryRawDocument>(rawDocumentSchema),
    audits: domainTable<string, MemoryAuditEntry>(auditEntrySchema),
  },
})
