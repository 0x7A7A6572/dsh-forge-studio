/**
 * plugin-notes 插件配置（dsh 0.1.7 的 settings 表单模型）。
 *
 * 命名空间 = profile 条目 id（bundle patch 的 `id: zzerx-notes`，见 cordis.patch.yml），
 * 值与插件 Config 同源：**字段一律 volatile**，因为设置表单只投影 volatile 字段，
 * 且 volatile 变更走 loader 的热更新（不重挂插件）。client 的「dsh 设置 → 便签」
 * 分区经 `ctx.configForms.get(NOTES_NAMESPACE)` 读写同一份（见 client/index.ts）。
 *
 * 旧模型（0.1.5/0.1.6 的 `ctx.settings.register(ns, schema, { base })`）在 0.1.7 已移除：
 * 这里不再有运行时注册，schema 直接作为插件 Config 由 loader 装配，缺省值来自
 * `.default()`（= 原 NOTES_CONFIG_BASE 那套 base）。
 *
 * 曾经这里还有「默认工作区」（任务未指定工作区时的兜底目录）：M1-4 起取消 ——
 * 任务必须有便签级工作区，host 侧也不再有任何兜底（见 service.runTaskExecute）。
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_NOTE_OPEN_MODE,
  DEFAULT_NOTES_ENTRY_CONFIG,
  DEFAULT_WEBDAV_CONFIG,
  NOTES_NAMESPACE,
} from './types.ts'
import type { NoteOpenMode, NotesConfig, NotesEntryConfig, NotesWebdavConfig } from './types.ts'

/** 设置命名空间（= profile 条目 id；client 设置分区以此取配置表单）。 */
export { NOTES_NAMESPACE }

/** 便签板的打开方式：只能取 types.ts NOTE_OPEN_MODES 里那两个值。 */
const openModeSchema = Schema.union([
  Schema.const('main').description('中间列（默认）'),
  Schema.const('right').description('右侧栏'),
]).default(DEFAULT_NOTE_OPEN_MODE)

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

/**
 * host 侧拿到的配置面：volatile 字段是引用（`Volatile`），`.get()` 取当前快照；
 * volatile 变更后引用不变、值变，所以调用方永远现取、不缓存。
 */
export interface Config {
  readonly defaultTitle: Volatile<string>
  readonly openMode: Volatile<NoteOpenMode>
  readonly entry: Volatile<NotesEntryConfig>
  readonly webdav: Volatile<NotesWebdavConfig>
}

/**
 * 插件 Config schema：loader 用它在装配时校验/补齐 config，settings 表单按 volatile
 * 字段投影出可热改的表单。`entry` / `webdav` 整体标 volatile（不是逐叶）：设置分区
 * 写入时就是整对象替换（`form.set('entry', next)`），整对象一个引用也少一层包装。
 */
export const Config = Schema.object({
  defaultTitle: Schema.string().default('新便签').volatile(),
  openMode: openModeSchema.volatile(),
  entry: entrySchema.volatile(),
  webdav: webdavSchema.volatile(),
})

/** 当前 WebDAV 配置（缺省合并：旧配置缺字段时按 DEFAULT_WEBDAV_CONFIG 补齐）。 */
export function webdavConfigOf(config: Config): NotesWebdavConfig {
  return { ...DEFAULT_WEBDAV_CONFIG, ...config.webdav.get() }
}

/** 当前便签配置快照（host 内部读取点的唯一入口）。 */
export function notesConfigOf(config: Config): NotesConfig {
  return {
    defaultTitle: config.defaultTitle.get(),
    openMode: config.openMode.get(),
    entry: config.entry.get(),
    webdav: webdavConfigOf(config),
  }
}

/**
 * 本插件自带设置页面（settings.section），据此关掉宿主按 schema 自建页面的策略：
 * 可选增强 —— settings 服务缺席（纯 UI 宿主）时本插件照常工作。
 */
export function configureNotesSettingsPage(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
