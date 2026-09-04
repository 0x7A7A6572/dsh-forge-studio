/**
 * notes storage domain 声明：identity、格式版本与 zod 记录 schema。
 * 数据持久化只走 ctx.storage（storage-json 后端）之上的 storage-domain，
 * 不自造持久化。
 */

import type { ZodType } from 'zod'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { DEFAULT_NOTE_COLOR, NOTE_COLORS, NOTE_ORIGINS, normalizeNoteColor } from './types.ts'
import type { NoteId, NoteRecord } from './types.ts'

/**
 * 任务状态枚举（与 types.ts 的 TaskStatus 保持同步）。写死字面量数组以防
 * domain ↔ types 出现 import 环；改动 types.ts 的 TaskStatus 时须同步此处。
 */
const NOTE_TASK_STATUSES = ['backlog', 'todo', 'running', 'done', 'failed'] as const

/**
 * 便签记录 schema：存储边界校验（storage-domain 打开时全量校验）。
 * color 带默认值：旧记录（v1 无该字段）打开时不炸，解析即回填默认黄。
 * zod 的 brand 与自有 Branded<NoteId> 符号不互通，这里用形状收窄声明，
 * 运行时校验仍覆盖全部字段。
 */
export const noteRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  pinned: z.boolean(),
  // archived 带默认值：v1 旧记录（无该字段）打开时不炸，解析即回填 false。
  archived: z.boolean().default(false),
  // color 带默认值：旧记录（v1 无该字段）打开时不炸，解析即回填默认黄。
  // preprocess 归一历史紫色（v1 曾含紫，任务泳道分类收敛后移除）→ 灰，防旧数据炸库。
  color: z.preprocess(
    (v) => normalizeNoteColor(v) ?? v,
    z.enum(NOTE_COLORS).default(DEFAULT_NOTE_COLOR),
  ),
  // origin 带默认值：v1 旧记录（无该字段）打开时不炸，解析即回填 'user'。
  origin: z.enum(NOTE_ORIGINS).default('user'),
  // lane 可选（无默认、不回填）：存在即任务（进泳道），缺省 = 普通便签。
  // 旧记录天然无该字段，解析不炸；status 用五状态字面量枚举，run 帧
  // startedAt 必填、finishedAt/ok/summary 可选。
  lane: z
    .object({
      status: z.enum(NOTE_TASK_STATUSES),
      run: z
        .object({
          startedAt: z.number(),
          finishedAt: z.number().optional(),
          ok: z.boolean().optional(),
          summary: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
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
