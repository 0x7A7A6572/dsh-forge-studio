/**
 * plugin-daily-log 插件配置（dsh 0.1.7 的 settings 表单模型）。
 *
 * 命名空间 = profile 条目 id（bundle patch 的 `id: zzerx-daily-log`，见 cordis.patch.yml），
 * 字段对齐 author/report/safety（去掉 model —— 模型路由走宿主）。与旧版
 * （`ctx.settings.register(ns, schema, { base, applies: 'live' })`，0.1.7 已移除）相比：
 * schema 直接作为插件 Config 由 loader 装配，字段一律 volatile，热更新经
 * `loader/volatile-update` 通知（见 installDailyLogSettings）。
 *
 * 另导出可订阅的配置访问句柄：`/report` 指令的注册与否跟随 `enableReportCommand`
 * 实时切换，因此注册方需要一个「读当前值 + 订阅变化」的稳定句柄。
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
// 类型增广：settings 服务（configure 策略）与 loader 的 `loader/volatile-update` 事件。
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { DAILY_LOG_NAMESPACE, type DailyLogConfig } from './types.ts'

export { DAILY_LOG_NAMESPACE }
/** 设置形状对调用方（如 /report 指令注册）可见，免去各自再引一次 types.ts。 */
export type { DailyLogConfig }

export const DAILY_LOG_CONFIG_BASE: DailyLogConfig = {
  authorName: '',
  authorEmail: '',
  outputDir: '',
  safeMode: true,
  enableReportCommand: true,
}

/**
 * host 侧配置面：volatile 引用，`.get()` 取当前值。逐叶 volatile（client 的表单
 * 按 key 单个写：`form.set('enableReportCommand', next)`）。
 */
export interface Config {
  readonly authorName: Volatile<string>
  readonly authorEmail: Volatile<string>
  readonly outputDir: Volatile<string>
  readonly safeMode: Volatile<boolean>
  readonly enableReportCommand: Volatile<boolean>
}

/** 插件 Config schema（settings 分区的表单由此投影）。 */
export const Config = Schema.object({
  authorName: Schema.string().default('').volatile(),
  authorEmail: Schema.string().default('').volatile(),
  outputDir: Schema.string().default('').volatile(),
  safeMode: Schema.boolean().default(true).volatile(),
  enableReportCommand: Schema.boolean().default(DAILY_LOG_CONFIG_BASE.enableReportCommand).volatile(),
})

/** 当前配置快照（host 内部读取点的唯一入口）。 */
export function dailyLogConfigOf(config: Config): DailyLogConfig {
  return {
    authorName: config.authorName.get(),
    authorEmail: config.authorEmail.get(),
    outputDir: config.outputDir.get(),
    safeMode: config.safeMode.get(),
    enableReportCommand: config.enableReportCommand.get(),
  }
}

/** 当前配置的稳定读取/订阅句柄；settings 未就绪时 get 返回 base。 */
export interface DailyLogSettingsAccess {
  get(): DailyLogConfig
  ready(): boolean
  watch(callback: (next: DailyLogConfig) => void): () => void
}

/**
 * 配置源（settings 服务作用域的窄视图）：只取本插件用到的读取与订阅能力，
 * watch 回调忽略第二个 prev 参数。dsh 0.1.7 起由 Config 的 volatile 引用驱动
 * （见 installDailyLogSettings），旧版由 settings.register 返回的 scope 驱动。
 */
interface SettingsScope {
  get(): DailyLogConfig
  watch(callback: (next: DailyLogConfig) => void): () => void
}

/** 可绑定的访问句柄：bind/dispose 由 installDailyLogSettings 在 settings 就绪后驱动。 */
export interface BindableDailyLogSettingsAccess extends DailyLogSettingsAccess {
  bind(scope: SettingsScope): void
  dispose(): void
}

/** 纯对象，不依赖 cordis —— 单测直接构造，不需要启宿主。 */
export function createDailyLogSettingsAccess(): BindableDailyLogSettingsAccess {
  let current: DailyLogConfig = { ...DAILY_LOG_CONFIG_BASE }
  let bound: (() => void) | undefined
  const watchers = new Set<(next: DailyLogConfig) => void>()
  const publish = (next: DailyLogConfig): void => {
    current = next
    for (const w of watchers) w(next)
  }
  return {
    get: () => current,
    ready: () => bound !== undefined,
    watch(callback) {
      watchers.add(callback)
      // 绑定后注册的 watcher 立刻拿到当前值；绑定前的由 bind 时的首次 publish 补齐。
      if (bound !== undefined) callback(current)
      return () => { watchers.delete(callback) }
    },
    bind(scope) {
      publish(scope.get())
      bound = scope.watch((next) => publish(next))
    },
    dispose() {
      bound?.()
      bound = undefined
      watchers.clear()
    },
  }
}

/**
 * 把配置访问句柄接到插件 Config 的 volatile 引用上：
 * - get 现取（`config.x.get()`，引用不变、值随热更新变化）；
 * - watch 订阅本插件 fiber 的 `loader/volatile-update`（只发给所属 fiber，无需过滤），
 *   每次变化重读全量快照并广播（等值变化 loader 不会通知）。
 */
export function installDailyLogSettings(ctx: Context, config: Config): DailyLogSettingsAccess {
  const access = createDailyLogSettingsAccess()
  access.bind({
    get: () => dailyLogConfigOf(config),
    watch: (callback) => ctx.on('loader/volatile-update', () => { callback(dailyLogConfigOf(config)) }),
  })
  ctx.effect(() => () => access.dispose())
  return access
}

/**
 * 本插件自带设置页面（settings.section），据此关掉宿主按 schema 自建页面的策略：
 * 可选增强 —— settings 服务缺席（纯 UI 宿主）时本插件照常工作。
 */
export function configureDailyLogSettingsPage(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
