/** 四个容器各自整段 volatile：容器内字段不能再 volatile（schemastery 禁止嵌套）。 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { BUILTIN_THEME_ID } from './shape/index.ts'
import { USAGE_BILLING_NAMESPACE } from './types.ts'
import type { EntryPosition } from './types.ts'

export { USAGE_BILLING_NAMESPACE }

export interface UsageBillingConfig {
  budget: { enabled: boolean; monthlyCny: number }
  display: {
    showUnpricedWarning: boolean
    showTierCurve: boolean
    /** 侧栏入口卡主题目录名：取值由磁盘决定（故为 string），找不到时回落内置主题。 */
    theme: string
    includeSubagents: boolean
    entryPosition: EntryPosition
    entrySidebar: boolean
    entryComposer: boolean
  }
  pricing: { autoRefresh: boolean; refreshHours: number }
  notices: { backfillDismissed: boolean; budgetNotified: Record<string, string> }
}

export const USAGE_BILLING_CONFIG_BASE: UsageBillingConfig = {
  budget: { enabled: false, monthlyCny: 100 },
  display: {
    showUnpricedWarning: true, showTierCurve: true, includeSubagents: true,
    entrySidebar: true, entryComposer: false, entryPosition: 'sidebar',
    theme: BUILTIN_THEME_ID,
  },
  pricing: { autoRefresh: true, refreshHours: 6 },
  notices: { backfillDismissed: false, budgetNotified: {} },
}

export interface Config {
  readonly budget: Volatile<UsageBillingConfig['budget']>
  readonly display: Volatile<UsageBillingConfig['display']>
  readonly pricing: Volatile<UsageBillingConfig['pricing']>
  readonly notices: Volatile<UsageBillingConfig['notices']>
}

export const Config = Schema.object({
  budget: Schema.object({
    enabled: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.budget.enabled),
    monthlyCny: Schema.number().default(USAGE_BILLING_CONFIG_BASE.budget.monthlyCny),
  }).default(USAGE_BILLING_CONFIG_BASE.budget).volatile(),
  display: Schema.object({
    showUnpricedWarning: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.showUnpricedWarning),
    showTierCurve: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.showTierCurve),
    theme: Schema.string().default(USAGE_BILLING_CONFIG_BASE.display.theme),
    includeSubagents: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.includeSubagents),
    entrySidebar: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.entrySidebar),
    entryComposer: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.entryComposer),
    entryPosition: Schema.union([
      Schema.const('sidebar'),
      Schema.const('composer'),
    ]).default(USAGE_BILLING_CONFIG_BASE.display.entryPosition),
  }).default(USAGE_BILLING_CONFIG_BASE.display).volatile(),
  pricing: Schema.object({
    autoRefresh: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.pricing.autoRefresh),
    refreshHours: Schema.number().default(USAGE_BILLING_CONFIG_BASE.pricing.refreshHours),
  }).default(USAGE_BILLING_CONFIG_BASE.pricing).volatile(),
  notices: Schema.object({
    backfillDismissed: Schema.boolean().default(false),
    /*
     * 必须是真字典：下发按 schema 声明字段投影，空 object 的 dict 是空的，会把字段裁掉。
     * 末尾 cast 只为绕过 Dict 类型不可解析（TS2742）。
     */
    budgetNotified: Schema.dict(Schema.string()).default({}) as unknown as Schema<Record<string, string>>,
  }).default(USAGE_BILLING_CONFIG_BASE.notices).volatile(),
})

export function usageBillingConfigOf(config: Config): UsageBillingConfig {
  return {
    budget: { ...USAGE_BILLING_CONFIG_BASE.budget, ...config.budget.get() },
    display: { ...USAGE_BILLING_CONFIG_BASE.display, ...config.display.get() },
    pricing: { ...USAGE_BILLING_CONFIG_BASE.pricing, ...config.pricing.get() },
    notices: { ...USAGE_BILLING_CONFIG_BASE.notices, ...config.notices.get() },
  }
}

export interface UsageBillingSettingsAccess {
  get(): UsageBillingConfig
  ready(): boolean
  watch(callback: (next: UsageBillingConfig) => void): () => void
}

interface SettingsScopeLike {
  get(): UsageBillingConfig
  watch(callback: (next: UsageBillingConfig) => void): () => void
}

export interface BindableUsageBillingSettingsAccess extends UsageBillingSettingsAccess {
  bind(scope: SettingsScopeLike): void
  dispose(): void
}

export function createUsageBillingSettingsAccess(): BindableUsageBillingSettingsAccess {
  let current: UsageBillingConfig = structuredClone(USAGE_BILLING_CONFIG_BASE)
  let bound: (() => void) | undefined
  // 退订后仍可能有已捕获的推送回流，句柄必须自行忽略。
  let disposed = false
  const watchers = new Set<(next: UsageBillingConfig) => void>()
  const publish = (next: UsageBillingConfig): void => {
    if (disposed) return
    current = next
    for (const w of watchers) w(next)
  }
  return {
    get: () => current,
    ready: () => bound !== undefined,
    watch(callback) {
      watchers.add(callback)
      if (bound !== undefined) callback(current)
      return () => { watchers.delete(callback) }
    },
    bind(scope) {
      // bind 接管活 scope 时必须复位：disposed 会让 publish 全部短路。
      disposed = false
      bound?.()
      publish(scope.get())
      bound = scope.watch((next) => publish(next))
    },
    dispose() {
      disposed = true
      bound?.(); bound = undefined; watchers.clear()
    },
  }
}

/** `loader/volatile-update` 只发给所属 fiber（无需过滤），等值变化不通知。 */
export function installUsageBillingSettings(ctx: Context, config: Config): UsageBillingSettingsAccess {
  const access = createUsageBillingSettingsAccess()
  access.bind({
    get: () => usageBillingConfigOf(config),
    watch: (callback) => ctx.on('loader/volatile-update', () => { callback(usageBillingConfigOf(config)) }),
  })
  ctx.effect(() => () => access.dispose())
  return access
}

/** 关掉宿主按 schema 自建设置页：本插件自带 settings.section。 */
export function configureUsageBillingSettingsPage(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
