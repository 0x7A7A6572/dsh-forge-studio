/**
 * plugin-notes 设置命名空间 `forge-studio.notes`：host 注册 schema + 组合 base，
 * client 便签板设置弹窗经 settingsScope 绑定同一命名空间读写 defaultTitle。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { NOTES_NAMESPACE, type NotesConfig } from './types.ts'

/** 设置命名空间（client 弹窗以此绑定 scope）。 */
export { NOTES_NAMESPACE }
export type { SettingsProvider }

export const NotesConfigSchema = Schema.object({
  defaultTitle: Schema.string().default('新便签'),
})

export const NOTES_CONFIG_BASE: NotesConfig = {
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
