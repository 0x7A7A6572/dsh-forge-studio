/**
 * 设置命名空间 `forge-studio-usage-billing`：host 注册 schema + 组合 base，
 * 并导出可订阅访问句柄（照抄 plugin-daily-log/src/settings.ts 的已验证模式）。
 * 预算 / 显示偏好 / 刷新策略 / 提示条状态 / installAt 都在这里。
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { USAGE_BILLING_NAMESPACE } from './types.ts'

export { USAGE_BILLING_NAMESPACE }

export interface UsageBillingConfig {
  budget: { enabled: boolean; monthlyCny: number }
  display: { showUnpricedWarning: boolean; includeSubagents: boolean }
  pricing: { autoRefresh: boolean; refreshHours: number }
  notices: { backfillDismissed: boolean; budgetNotified: Record<string, string> }
  /** 首次装配时刻（回填判定基准，spec §5.6）。 */
  installAt: number
}

export const USAGE_BILLING_CONFIG_BASE: UsageBillingConfig = {
  budget: { enabled: false, monthlyCny: 100 },
  display: { showUnpricedWarning: true, includeSubagents: true },
  pricing: { autoRefresh: true, refreshHours: 6 },
  notices: { backfillDismissed: false, budgetNotified: {} },
  installAt: 0,
}

export const UsageBillingConfigSchema = Schema.object({
  budget: Schema.object({
    enabled: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.budget.enabled),
    monthlyCny: Schema.number().default(USAGE_BILLING_CONFIG_BASE.budget.monthlyCny),
  }),
  display: Schema.object({
    showUnpricedWarning: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.showUnpricedWarning),
    includeSubagents: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.includeSubagents),
  }),
  pricing: Schema.object({
    autoRefresh: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.pricing.autoRefresh),
    refreshHours: Schema.number().default(USAGE_BILLING_CONFIG_BASE.pricing.refreshHours),
  }),
  notices: Schema.object({
    backfillDismissed: Schema.boolean().default(false),
    // Schema.dict 的返回类型引用 @deepseek-ai/cosmokit 的 Dict（本包不可解析，导出常量的声明推断会 TS2742），
    // 故改用 brief 允许的兜底写法 `Schema.object({})` + 类型断言（见 task-11-report.md）。
    budgetNotified: Schema.object({}).default({}) as unknown as Schema<Record<string, string>>,
  }),
  installAt: Schema.number().default(0),
})

export interface UsageBillingSettingsAccess {
  get(): UsageBillingConfig
  ready(): boolean
  watch(callback: (next: UsageBillingConfig) => void): () => void
}

interface SettingsScopeLike {
  get(): UsageBillingConfig
  watch(callback: (next: UsageBillingConfig) => void): () => void
}

/**
 * `ctx.settings` 的最小窄视图。它的类型增强由 `@deepseek-ai/dsh-settings` 提供，但该包在本仓
 * 只写进了 package.json、未链接进 node_modules（也不在 pnpm-lock 的 importer 里），import 会
 * 直接 TS2307。运行时服务存在性由 `ctx.inject(['settings'])` 保证（本文件未新增跨插件运行时依赖），
 * 因此这里只声明用到的 register 能力；依赖被链接后可换回 `SettingsProvider`。
 */
interface SettingsProviderLike {
  register(
    namespace: string,
    schema: unknown,
    options: { base: UsageBillingConfig; applies: 'live' },
  ): SettingsScopeLike
}

export interface BindableUsageBillingSettingsAccess extends UsageBillingSettingsAccess {
  bind(scope: SettingsScopeLike): void
  dispose(): void
}

/** 纯对象访问句柄：单测可直接构造，不需要启宿主。 */
export function createUsageBillingSettingsAccess(): BindableUsageBillingSettingsAccess {
  let current: UsageBillingConfig = structuredClone(USAGE_BILLING_CONFIG_BASE)
  let bound: (() => void) | undefined
  // dispose 后仍可能有已被 scope 捕获的推送回流（上游退订失败/迟到），句柄必须自行忽略。
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
      publish(scope.get())
      bound = scope.watch((next) => publish(next))
    },
    dispose() {
      disposed = true
      bound?.(); bound = undefined; watchers.clear()
    },
  }
}

export function installUsageBillingSettings(ctx: Context): UsageBillingSettingsAccess {
  const access = createUsageBillingSettingsAccess()
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = (settingsCtx as Context & { settings: SettingsProviderLike }).settings
    access.bind(settings.register(USAGE_BILLING_NAMESPACE, UsageBillingConfigSchema, {
      base: USAGE_BILLING_CONFIG_BASE,
      applies: 'live',
    }))
  })
  ctx.effect(() => () => access.dispose())
  return access
}
