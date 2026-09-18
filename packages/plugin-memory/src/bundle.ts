/**
 * 备份文件的服务端校验。
 *
 * 文件是从磁盘读进来的，等于不可信输入 —— 直接 put 进库里会把半个坏记录写进存储。
 * 这里复用 domain.ts 的 zod schema：它本来就在存储边界上跑，顺带把旧版备份缺的字段
 * 用 default 补齐，所以跨版本导入不会因为多了/少了可选字段就失败。
 */

import { memoryEdgeSchema, memoryEntitySchema, memoryRecordSchema } from './domain.ts'
import { MEMORY_BUNDLE_SCHEMA, MEMORY_BUNDLE_VERSION } from './types.ts'
import type { MemoryBundle, MemoryEdge, MemoryEntity, MemoryRecord } from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 逐条过 schema；第几条坏了要说清楚，否则用户面对一坨 JSON 无从下手。 */
function parseEach<T>(schema: { safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: { issues: readonly { message: string }[] } } }, list: readonly unknown[], what: string): T[] {
  return list.map((entry, index) => {
    const parsed = schema.safeParse(entry)
    if (!parsed.success) {
      const reason = parsed.error.issues[0]?.message ?? '未知原因'
      throw new Error(`备份里第 ${index + 1} 条${what}格式不对：${reason}`)
    }
    return parsed.data as T
  })
}

/** 校验并规范化备份载荷。通过后返回补齐默认字段的副本；失败抛人类可读的错。 */
export function validateMemoryBundle(raw: unknown): MemoryBundle {
  if (!isRecord(raw)) throw new Error('这个文件不是 JSON 对象')
  if (raw.schema !== MEMORY_BUNDLE_SCHEMA) throw new Error('不是 plugin-memory 的备份文件（schema 不符）')
  if (raw.version !== MEMORY_BUNDLE_VERSION) {
    throw new Error(`备份版本不兼容（文件是 ${String(raw.version)}，本插件认 ${MEMORY_BUNDLE_VERSION}）`)
  }
  if (!Array.isArray(raw.records)) throw new Error('备份文件缺 records 数组')
  if (!Array.isArray(raw.entities)) throw new Error('备份文件缺 entities 数组')
  if (!Array.isArray(raw.edges)) throw new Error('备份文件缺 edges 数组')
  return {
    schema: MEMORY_BUNDLE_SCHEMA,
    version: MEMORY_BUNDLE_VERSION,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : Date.now(),
    records: parseEach<MemoryRecord>(memoryRecordSchema, raw.records, '记忆'),
    entities: parseEach<MemoryEntity>(memoryEntitySchema, raw.entities, '实体'),
    edges: parseEach<MemoryEdge>(memoryEdgeSchema, raw.edges, '关联边'),
  }
}
