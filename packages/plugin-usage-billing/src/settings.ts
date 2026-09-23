/**
 * plugin-usage-billing 插件配置（dsh 0.1.7 的 settings 表单模型）。
 *
 * 命名空间 = profile 条目 id（bundle patch 的 `id: usage-billing-zzerx`，见
 * cordis.patch.yml）。预算 / 显示偏好 / 刷新策略 / 提示条状态都在这里
 * （安装时刻**不**在这里：它由 host 装配时决定并经 `status()` 端点读取，配置里既没有
 * 写入路径、也不需要一份可能过期的副本）。
 *
 * 四个容器各自整段 volatile：面板写入时就是整对象替换（`form.set('display', next)`），
 * 容器内字段不再逐个 volatile（schemastery 禁止 volatile 里套 volatile）。
 * 旧模型（`ctx.settings.register(ns, schema, { base, applies: 'live' })`，0.1.7 已移除）
 * 改由 loader 装配本 Config，热更新经 `loader/volatile-update` 通知（见 install…）。
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { USAGE_BILLING_NAMESPACE } from './types.ts'
import type { EntryPosition } from './types.ts'

export { USAGE_BILLING_NAMESPACE }

export interface UsageBillingConfig {
  budget: { enabled: boolean; monthlyCny: number }
  display: {
    showUnpricedWarning: boolean
    /** 计费弹窗顶部画今日峰谷时段图（首装默认开）。 */
    showTierCurve: boolean
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
    showUnpricedWarning: true, showTierCurve: true, includeSubagents: true,
    entrySidebar: true, entryComposer: false, entryPosition: 'sidebar',
  },
  pricing: { autoRefresh: true, refreshHours: 6 },
  notices: { backfillDismissed: false, budgetNotified: {} },
}

/** host 侧配置面：四个容器各是一个 volatile 引用，`.get()` 取当前值。 */
export interface Config {
  readonly budget: Volatile<UsageBillingConfig['budget']>
  readonly display: Volatile<UsageBillingConfig['display']>
  readonly pricing: Volatile<UsageBillingConfig['pricing']>
  readonly notices: Volatile<UsageBillingConfig['notices']>
}

/** 插件 Config schema（settings 分区的表单由此投影）。 */
export const Config = Schema.object({
  budget: Schema.object({
    enabled: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.budget.enabled),
    monthlyCny: Schema.number().default(USAGE_BILLING_CONFIG_BASE.budget.monthlyCny),
  }).default(USAGE_BILLING_CONFIG_BASE.budget).volatile(),
  display: Schema.object({
    showUnpricedWarning: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.showUnpricedWarning),
    showTierCurve: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.display.showTierCurve),
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
  }).default(USAGE_BILLING_CONFIG_BASE.display).volatile(),
  pricing: Schema.object({
    autoRefresh: Schema.boolean().default(USAGE_BILLING_CONFIG_BASE.pricing.autoRefresh),
    refreshHours: Schema.number().default(USAGE_BILLING_CONFIG_BASE.pricing.refreshHours),
  }).default(USAGE_BILLING_CONFIG_BASE.pricing).volatile(),
  notices: Schema.object({
    backfillDismissed: Schema.boolean().default(false),
    /*
     * **必须是 dict，不能是 `Schema.object({})`。** dsh 把设置值下发到浏览器时是**按 schema
     * 声明字段投影**的（harness `packages/settings/settings/src/schema.ts#projectForm`：object
     * 类型只保留 `schema.dict` 里声明过的键），而空 object 的 `dict` 是空的 —— 于是
     * `budgetNotified: {"2026-09": "1"}` 被裁成 `{}`：宿主落盘是对的，客户端却永远读不到
     * 「本月该档已提醒」，60s 心跳每重判一次就重弹一次跨档提醒（现象：点「知道了」后同一页
     * 待一会儿又自己冒出来）。投影对 dict 类型原样放行，所以这里用真字典。
     *
     * 末尾的 cast 只解决类型：`Schema.dict` 的返回类型引用 @deepseek-ai/cosmokit 的 Dict
     * （schemastery 的传递依赖，pnpm 严格隔离下本包不可解析），导出常量的声明推断会 TS2742
     * （诊断留在 task-11-report.md：src/settings.ts(32,14) cannot be named without a reference to
     * '.pnpm/@deepseek-ai+cosmokit@1.8.3/node_modules/@deepseek-ai/cosmokit'）。运行时仍是左边
     * 这个真正的 dict schema，与 `UsageBillingConfig['notices']['budgetNotified']` 一致。
     */
    budgetNotified: Schema.dict(Schema.string()).default({}) as unknown as Schema<Record<string, string>>,
  }).default(USAGE_BILLING_CONFIG_BASE.notices).volatile(),
})

/** 当前配置快照（host 内部读取点的唯一入口；容器缺字段时按 base 补齐）。 */
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

/**
 * 配置源（settings 服务作用域的窄视图）：只取本插件用到的读取与订阅能力，
 * watch 回调忽略第二个 prev 参数。dsh 0.1.7 起由 Config 的 volatile 引用驱动
 * （见 installUsageBillingSettings），旧版由 settings.register 返回的 scope 驱动。
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

/**
 * 把配置访问句柄接到插件 Config 的 volatile 引用上：
 * - get 现取（`config.x.get()`，引用不变、值随热更新变化）；
 * - watch 订阅本插件 fiber 的 `loader/volatile-update`（只发给所属 fiber，无需过滤），
 *   每次变化重读全量快照并广播（等值变化 loader 不会通知）。
 */
export function installUsageBillingSettings(ctx: Context, config: Config): UsageBillingSettingsAccess {
  const access = createUsageBillingSettingsAccess()
  access.bind({
    get: () => usageBillingConfigOf(config),
    watch: (callback) => ctx.on('loader/volatile-update', () => { callback(usageBillingConfigOf(config)) }),
  })
  ctx.effect(() => () => access.dispose())
  return access
}

/**
 * 本插件自带设置页面（settings.section），据此关掉宿主按 schema 自建页面的策略：
 * 可选增强 —— settings 服务缺席（纯 UI 宿主）时本插件照常工作。
 */
export function configureUsageBillingSettingsPage(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
