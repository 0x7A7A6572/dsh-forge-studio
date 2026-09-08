/**
 * daily-log storage domain 声明：identity、格式版本与 zod 记录 schema。
 * 三表：sources（数据源）/ reports（报告）/ templates（模板）。per-record 布局。
 * 数据持久化只走 ctx.storage（storage-json）之上的 storage-domain，不自造持久化。
 */

import type { ZodType } from 'zod'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { SOURCE_TYPES } from './types.ts'
import type {
  ReportId, ReportRecord, SourceId, SourceRecord, TemplateId, TemplateRecord,
} from './types.ts'

/**
 * 项目记录 schema（存储边界校验；type 缺省 other 兼容升级前旧记录）。
 * `.passthrough()` 保留未知键：升级前旧记录残留的 kind 字段得以读入内存，
 * 供 service 启动迁移判定（git→项目 / 会话目录类→丢弃）后清理；新记录无 kind。
 */
export const sourceRecordSchema = z.object({
  id: z.string(),
  type: z.enum(SOURCE_TYPES).default('other'),
  label: z.string(),
  path: z.string(),
  author: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).passthrough() as unknown as ZodType<SourceRecord>

/** 报告记录 schema。 */
export const reportRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  markdown: z.string(),
  sourceIds: z.array(z.string()),
  templateId: z.string().optional(),
  reportType: z.string().optional(),
  dateRange: z.object({
    since: z.string(),
    until: z.string().optional(),
  }),
  createdAt: z.number(),
}) as unknown as ZodType<ReportRecord>

/** 模板记录 schema。 */
export const templateRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  isBuiltin: z.boolean(),
  isDefault: z.boolean(),
  updatedAt: z.number(),
}) as unknown as ZodType<TemplateRecord>

/** daily-log 域：sources / reports / templates 三表，per-record 布局。 */
export const dailyLogDomain = defineDomain({
  name: 'daily_log',
  version: 1,
  layout: 'per-record',
  tables: {
    sources: domainTable<SourceId, SourceRecord>(sourceRecordSchema),
    reports: domainTable<ReportId, ReportRecord>(reportRecordSchema),
    templates: domainTable<TemplateId, TemplateRecord>(templateRecordSchema),
  },
})
