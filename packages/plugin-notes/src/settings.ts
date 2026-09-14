/**
 * plugin-notes 设置命名空间 `forge-studio.notes`：host 注册 schema + 组合 base，
 * client 便签板设置弹窗经 settingsScope 绑定同一命名空间读写 defaultTitle。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_WEBDAV_CONFIG, DEFAULT_WORKSPACE, NOTES_NAMESPACE } from './types.ts'
import type { NotesConfig, NotesWebdavConfig } from './types.ts'

/** 设置命名空间（client 弹窗以此绑定 scope）。 */
export { NOTES_NAMESPACE }
export type { SettingsProvider }

const webdavSchema = Schema.object({
  enabled: Schema.boolean().default(false),
  url: Schema.string().default(''),
  username: Schema.string().default(''),
  password: Schema.string().default(''),
  path: Schema.string().default('dsh/notes/'),
  intervalMin: Schema.number().min(1).max(1440).default(30),
  keep: Schema.number().min(1).max(99).default(10),
}).default(DEFAULT_WEBDAV_CONFIG as NotesWebdavConfig)

export const NotesConfigSchema = Schema.object({
  defaultTitle: Schema.string().default('新便签'),
  // 任务执行默认工作区（绝对目录路径）：空串 = 未配置。
  defaultWorkspace: Schema.string().default(DEFAULT_WORKSPACE),
  webdav: webdavSchema,
})

export const NOTES_CONFIG_BASE: NotesConfig = {
  defaultTitle: '新便签',
  defaultWorkspace: DEFAULT_WORKSPACE,
  webdav: DEFAULT_WEBDAV_CONFIG,
}

export function installNotesSettings(ctx: Context): void {
  ctx.inject(['settings'], (ctx) => {
    ctx.settings.register(NOTES_NAMESPACE, NotesConfigSchema, {
      base: NOTES_CONFIG_BASE,
      applies: 'live',
    })
  })
}