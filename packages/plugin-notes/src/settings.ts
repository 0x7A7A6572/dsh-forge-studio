/**
 * plugin-notes 设置命名空间 `forge-studio.notes`：host 注册 schema + 组合 base，
 * client 设置卡片经 settingsScope 绑定同一命名空间读写。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { NOTES_NAMESPACE, type NotesConfig } from './types.ts'

/** 设置命名空间（client 卡片以此作为 settings.plugin.item 的 key）。 */
export { NOTES_NAMESPACE }
export type { SettingsProvider }

export const NotesConfigSchema = Schema.object({
  maxVisibleNotes: Schema.number().default(8),
  defaultTitle: Schema.string().default('新便签'),
})

export const NOTES_CONFIG_BASE: NotesConfig = {
  maxVisibleNotes: 8,
  defaultTitle: '新便签',
}

export function installNotesSettings(ctx: Context): void {
  ctx.inject(['settings'], (ctx) => {
    ctx.settings.register(NOTES_NAMESPACE, NotesConfigSchema, {
      base: NOTES_CONFIG_BASE,
      applies: 'live',
    })
  })
}
