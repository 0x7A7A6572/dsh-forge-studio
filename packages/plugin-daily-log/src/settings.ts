/**
 * plugin-daily-log 设置命名空间 `forge-studio-daily-log`：host 注册 schema + 组合 base。
 * 字段对齐 author/report/safety（去掉 model——模型路由走宿主）。
 *
 * 另导出可订阅的配置访问句柄：`/report` 指令的注册与否跟随 `enableReportCommand`
 * 实时切换，因此注册方需要一个「读当前值 + 订阅变化」的稳定句柄。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { DAILY_LOG_NAMESPACE, type DailyLogConfig } from './types.ts'

export { DAILY_LOG_NAMESPACE }
export type { SettingsProvider }
/** 设置形状对调用方（如 /report 指令注册）可见，免去各自再引一次 types.ts。 */
export type { DailyLogConfig }

export const DAILY_LOG_CONFIG_BASE: DailyLogConfig = {
  authorName: '',
  authorEmail: '',
  outputDir: '',
  safeMode: true,
  enableReportCommand: true,
}

export const DailyLogConfigSchema = Schema.object({
  authorName: Schema.string().default(''),
  authorEmail: Schema.string().default(''),
  outputDir: Schema.string().default(''),
  safeMode: Schema.boolean().default(true),
  enableReportCommand: Schema.boolean().default(DAILY_LOG_CONFIG_BASE.enableReportCommand),
})

/** 当前配置的稳定读取/订阅句柄；settings 未就绪时 get 返回 base。 */
export interface DailyLogSettingsAccess {
  get(): DailyLogConfig
  ready(): boolean
  watch(callback: (next: DailyLogConfig) => void): () => void
}

/**
 * 已注册命名空间的作用域（settings 服务 register 返回值的窄视图）：
 * 只取本插件用到的读取与订阅能力，watch 回调忽略第二个 prev 参数。
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

export function installDailyLogSettings(ctx: Context): DailyLogSettingsAccess {
  const access = createDailyLogSettingsAccess()
  ctx.inject(['settings'], (settingsCtx) => {
    access.bind(settingsCtx.settings.register(DAILY_LOG_NAMESPACE, DailyLogConfigSchema, {
      base: DAILY_LOG_CONFIG_BASE,
      applies: 'live',
    }))
  })
  ctx.effect(() => () => access.dispose())
  return access
}
