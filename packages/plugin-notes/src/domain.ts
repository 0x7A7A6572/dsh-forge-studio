/**
 * notes storage domain 声明：identity、格式版本与 zod 记录 schema。
 * 数据持久化只走 ctx.storage（storage-json 后端）之上的 storage-domain，
 * 不自造持久化。
 */

import type { ZodType } from 'zod'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { NoteId, NoteRecord } from './types.ts'

/**
 * 便签记录 schema：存储边界校验（storage-domain 打开时全量校验）。
 * zod 的 brand 与自有 Branded<NoteId> 符号不互通，这里用形状收窄声明，
 * 运行时校验仍覆盖全部字段。
 */
export const noteRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  pinned: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
}) as unknown as ZodType<NoteRecord>

/**
 * notes 域：单一 notes 表，per-record 布局（每条便签一份文档，便于增删）。
 * 格式版本 1；介质版本不符会在 open 时拒绝。
 */
export const notesDomain = defineDomain({
  name: 'notes',
  version: 1,
  layout: 'per-record',
  tables: {
    notes: domainTable<NoteId, NoteRecord>(noteRecordSchema),
  },
})
