/**
 * WebDAV 备份引擎的 meta 存储域：单条状态记录（上次备份/恢复时间与结果、
 * watermark 水位），与便签域分开，避免恢复流程把引擎状态也一并覆盖。
 * 持久化仍走 ctx.storage（storage-json）之上的 storage-domain。
 */

import type { ZodType } from 'zod'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** 引擎状态记录（键恒为 'meta'，单条）。 */
export interface WebdavMeta {
  /** 上次成功备份时刻；从未成功 = null。 */
  lastBackupAt: number | null
  /** 上次成功备份的文件名；从未成功 = null。 */
  lastBackupName: string | null
  /** 上次备份是否成功；从未尝试 = null。 */
  lastBackupOk: boolean | null
  /** 上次失败原因（成功时为 null）。 */
  lastBackupError: string | null
  /** 已上传便签的最大 updatedAt（有变更才传的水位）。 */
  watermark: number | null
  /** 上次恢复时刻；从未恢复 = null。 */
  lastRestoreAt: number | null
  /** 上次恢复来源文件；从未恢复 = null。 */
  lastRestoreName: string | null
  /** 上次恢复是否成功；从未尝试 = null。 */
  lastRestoreOk: boolean | null
}

/** 空 meta（所有字段可空；写入前由引擎补齐）。 */
export function emptyWebdavMeta(): WebdavMeta {
  return {
    lastBackupAt: null,
    lastBackupName: null,
    lastBackupOk: null,
    lastBackupError: null,
    watermark: null,
    lastRestoreAt: null,
    lastRestoreName: null,
    lastRestoreOk: null,
  }
}

export const webdavMetaSchema = z.object({
  lastBackupAt: z.number().nullable(),
  lastBackupName: z.string().nullable(),
  lastBackupOk: z.boolean().nullable(),
  lastBackupError: z.string().nullable(),
  watermark: z.number().nullable(),
  lastRestoreAt: z.number().nullable(),
  lastRestoreName: z.string().nullable(),
  lastRestoreOk: z.boolean().nullable(),
}) as unknown as ZodType<WebdavMeta>

/** meta 域：单表 meta，键 'meta'。格式版本 1。 */
export const webdavMetaDomain = defineDomain({
  name: 'notes_webdav',
  version: 1,
  layout: 'per-record',
  tables: {
    meta: domainTable<string, WebdavMeta>(webdavMetaSchema),
  },
})

/** meta 记录的固定键。 */
export const WEBDAV_META_KEY = 'meta'