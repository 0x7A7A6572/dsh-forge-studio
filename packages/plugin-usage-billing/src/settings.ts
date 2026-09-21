/**
 * 设置命名空间 `forge-studio-usage-billing`：host 注册 schema + 组合 base，
 * 并导出可订阅访问句柄（照抄 plugin-daily-log/src/settings.ts 的已验证模式）。
 * 预算 / 显示偏好 / 刷新策略 / 提示条状态都在这里（安装时刻**不**在这里：它由 host 装配时
 * 决定并经 `status()` 端点读取，设置命名空间里既没有写入路径、也不需要一份可能过期的副本）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { USAGE_BILLING_NAMESPACE } from './types.ts'
import type { EntryPosition } from './types.ts'

export { USAGE_BILLING_NAMESPACE }
export type { SettingsProvider }

export interface UsageBillingConfig {
  budget: { enabled: boolean; monthlyCny: number }
  display: {
    showUnpricedWarning: boolean
    includeSubagents: boolean
    /** 旧配置的落点：已无写入口，只在两个开关都缺席时被读侧翻译。 */
    entryPosition: EntryPosition
    /** 侧边栏底部入口开关（首装默认开，与旧落点的「侧栏」一致）。 */
    entrySidebar: boolean
    /** 输入框下方入口开关（首装默认关）。 */
    entryComposer: boolean
  }
  pricing: { autoRefresh: boolean; refreshHours: number }
  notices: { backfillDismissed: boolean; budgetNotified: Record<string, string> }
}

export const USAGE_BILLING_CONFIG_BASE: UsageBillingConfig = {
  budget: { enabled: false, monthlyCny: 100 },
  display: {
    showUnpricedWarning: true, includeSubagents: true,
    entrySidebar: true, entryComposer: false, entryPosition: 'sidebar',
  },
  pricing: { autoRefresh: true, refreshHours: 6 },
  notices: { backfillDismissed: false, budgetNotified: {} },
}

export const UsageBillingConfigSchema = Schema.object({
  budget: Schema.object({
    enabled: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.budget.enabled),
    monthlyCny: Schema.number().default(USAGE_BILLING_CONFIG_BASE.budget.monthlyCny),
  }),
  display: Schema.object({
    showUnpricedWarning: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.showUnpricedWarning),
    includeSubagents: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.includeSubagents),
    // 首装默认 = 只开侧栏（旧落点 base 的 sidebar）；旧配置的 entryPosition 仍在下方，
    // 但校验后字段一律补齐，所以旧值只对「还没写开关的旧 host」有翻译价值。
    entrySidebar: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.entrySidebar),
    entryComposer: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.entryComposer),
    // 枚举走 Schema.union + const（与 plugin-notes 的 openMode 同一写法）：字符串枚举
    // 用 Schema.string() 会让脏值一路透传到视图。仅兼容旧配置，不再有写入口。
    entryPosition: Schema.union([
      Schema.const('sidebar'),
      Schema.const('composer'),
    ]).default(USAGE_BILLING_CONFIG_BASE.display.entryPosition),
  }),
  pricing: Schema.object({
    autoRefresh: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.pricing.autoRefresh),
    refreshHours: Schema.number().default(USAGE_BILLING_CONFIG_BASE.pricing.refreshHours),
  }),
  notices: Schema.object({
    backfillDismissed: Schema.boolean().default(false),
    // Schema.dict 的返回类型引用 @deepseek-ai/cosmokit 的 Dict（schemastery 的传递依赖，pnpm 严格隔离下
    // 本包不可解析），导出常量的声明推断会 TS2742 —— 链接 dsh-settings 后复测仍然如此，
    // 故保留 brief Step 4 允许的兜底写法并记录诊断（见 task-11-report.md）：
    //   src/settings.ts(32,14): error TS2742: The inferred type of 'UsageBillingConfigSchema' cannot be named
    //   without a reference to '.pnpm/@deepseek-ai+cosmokit@1.8.3/node_modules/@deepseek-ai/cosmokit'.
    budgetNotified: Schema.object({}).default({}) as unknown as Schema<Record<string, string>>,
  }),
})

export interface UsageBillingSettingsAccess {
  get(): UsageBillingConfig
  ready(): boolean
  watch(callback: (next: UsageBillingConfig) => void): () => void
}

/**
 * 已注册命名空间的作用域（`SettingsProvider.register` 返回值的窄视图）：
 * 只取本插件用到的读取与订阅能力，watch 回调忽略第二个 prev 参数。
 */
interface SettingsScopeLike {
  get(): UsageBillingConfig
  watch(callback: (next: UsageBillingConfig) => void): () => void
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
      // 新的 bind 接管的是一个「活的」scope：必须复位 dispose 留下的闩。否则 publish 全部短路，
      // 而 watch 会把 dispose 之前的陈旧 current 当成新 provider 的值重放（ready() 却仍为 true）。
      disposed = false
      // 上一次 bind 的订阅必须先解绑，否则 bind(s1); bind(s2) 会双订阅，之后每次变化都推两遍。
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

export function installUsageBillingSettings(ctx: Context): UsageBillingSettingsAccess {
  const access = createUsageBillingSettingsAccess()
  ctx.inject(['settings'], (settingsCtx) => {
    access.bind(settingsCtx.settings.register(USAGE_BILLING_NAMESPACE, UsageBillingConfigSchema, {
      base: USAGE_BILLING_CONFIG_BASE,
      applies: 'live',
    }))
  })
  ctx.effect(() => () => access.dispose())
  return access
}
