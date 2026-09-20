/**
 * plugin-notes 设置命名空间 `forge-studio.notes`：host 注册 schema + 组合 base，
 * client 的「dsh 设置 → 便签」分区经 settingsScope 绑定同一命名空间读写 defaultTitle。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_NOTE_OPEN_MODE,
  DEFAULT_NOTES_ENTRY_CONFIG,
  DEFAULT_WEBDAV_CONFIG,
  DEFAULT_WORKSPACE,
  NOTES_NAMESPACE,
} from './types.ts'
import type { NotesConfig, NotesEntryConfig, NotesWebdavConfig } from './types.ts'

/** 设置命名空间（client 设置分区以此绑定 scope）。 */
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

/**
 * UI 入口开关 schema：逐项与 DEFAULT_NOTES_ENTRY_CONFIG 对齐（新入口加在这里，
 * 缺省值只在 types.ts 定义一次，避免两处漂移）。
 */
const entrySchema = Schema.object({
  sidebarPanelIcon: Schema.boolean().default(DEFAULT_NOTES_ENTRY_CONFIG.sidebarPanelIcon),
  inputToolbar: Schema.boolean().default(DEFAULT_NOTES_ENTRY_CONFIG.inputToolbar),
  saveMessageAction: Schema.boolean().default(DEFAULT_NOTES_ENTRY_CONFIG.saveMessageAction),
  rightSidebarGuide: Schema.boolean().default(DEFAULT_NOTES_ENTRY_CONFIG.rightSidebarGuide),
}).default(DEFAULT_NOTES_ENTRY_CONFIG as NotesEntryConfig)

/** 便签板的打开方式：只能取 types.ts NOTE_OPEN_MODES 里那两个值。 */
const openModeSchema = Schema.union([
  Schema.const('main').description('中间列（默认）'),
  Schema.const('right').description('右侧栏'),
]).default(DEFAULT_NOTE_OPEN_MODE)

export const NotesConfigSchema = Schema.object({
  defaultTitle: Schema.string().default('新便签'),
  // 任务执行默认工作区（绝对目录路径）：空串 = 未配置。
  defaultWorkspace: Schema.string().default(DEFAULT_WORKSPACE),
  openMode: openModeSchema,
  entry: entrySchema,
  webdav: webdavSchema,
})

export const NOTES_CONFIG_BASE: NotesConfig = {
  defaultTitle: '新便签',
  defaultWorkspace: DEFAULT_WORKSPACE,
  openMode: DEFAULT_NOTE_OPEN_MODE,
  entry: DEFAULT_NOTES_ENTRY_CONFIG,
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