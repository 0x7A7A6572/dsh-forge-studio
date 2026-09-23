/**
 * plugin-memory 插件配置（dsh 0.1.7 的 settings 表单模型）。
 *
 * 命名空间 = profile 条目 id（bundle patch 的 `id: zzerx-memory`，见 cordis.patch.yml）。
 * 面板上的「生成对话记忆」开关即 autoCapture；注入相关字段同表，全部 volatile
 * （面板按字段逐个写，改值经 loader 热更新，不重挂插件）。
 *
 * 读取走一个稳定的 access 句柄：
 * - get() 现读 Config 的 volatile 引用（引用不变、值随热更新变化），任何时刻可读；
 * - update(patch) 经 settings 服务写入本插件 profile 条目的用户层，settings 服务
 *   晚于本插件就绪时抛可读错误（旧版由 register 返回的 scope.update 提供，0.1.7 已移除）。
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { MEMORY_CONFIG_BASE, MEMORY_NAMESPACE, type MemoryConfig } from './types.ts'

export { MEMORY_NAMESPACE }

/**
 * host 侧配置面：volatile 引用，`.get()` 取当前值。逐叶 volatile —— 面板写的是
 * 单个字段（`settings.update('zzerx-memory', { autoCapture: false })`）。
 */
export interface Config {
  readonly autoCapture: Volatile<boolean>
  readonly autoInject: Volatile<boolean>
  readonly maxInjected: Volatile<number>
  readonly importanceThreshold: Volatile<number>
  readonly captureEveryTurns: Volatile<number>
  readonly captureMaxTurns: Volatile<number>
  readonly captureMaxChars: Volatile<number>
  readonly captureIncludeAssistant: Volatile<boolean>
  readonly llmProvider: Volatile<string>
  readonly llmModel: Volatile<string>
}

/** 插件 Config schema（settings 分区的表单由此投影）。 */
export const Config = Schema.object({
  autoCapture: Schema.boolean().default(MEMORY_CONFIG_BASE.autoCapture).volatile(),
  autoInject: Schema.boolean().default(MEMORY_CONFIG_BASE.autoInject).volatile(),
  maxInjected: Schema.natural().min(1).max(20).default(MEMORY_CONFIG_BASE.maxInjected).volatile(),
  importanceThreshold: Schema.natural().min(1).max(5).default(MEMORY_CONFIG_BASE.importanceThreshold).volatile(),
  captureEveryTurns: Schema.natural().min(1).max(20).default(MEMORY_CONFIG_BASE.captureEveryTurns).volatile(),
  captureMaxTurns: Schema.natural().min(1).max(24).default(MEMORY_CONFIG_BASE.captureMaxTurns).volatile(),
  captureMaxChars: Schema.natural().min(500).max(12000).default(MEMORY_CONFIG_BASE.captureMaxChars).volatile(),
  captureIncludeAssistant: Schema.boolean().default(MEMORY_CONFIG_BASE.captureIncludeAssistant).volatile(),
  // 后台模型：空串 = 不指定（沿用会话自身 / agentDefaultModel）。目录由面板下拉给出，
  // 这里只存值 —— provider / model 被删时调用失败仍是 fail-safe，不做启动期校验。
  llmProvider: Schema.string()
    .description('后台流程（对话提炼 / 写入判定）使用的模型 provider；与 llmModel 一起留空表示跟随会话默认。')
    .default(MEMORY_CONFIG_BASE.llmProvider)
    .volatile(),
  llmModel: Schema.string()
    .description('后台流程使用的模型 id；需与 llmProvider 同时填写，面板里用下拉选择。')
    .default(MEMORY_CONFIG_BASE.llmModel)
    .volatile(),
})

/** 当前配置快照（host 内部读取点的唯一入口）。 */
export function memoryConfigOf(config: Config): MemoryConfig {
  return {
    autoCapture: config.autoCapture.get(),
    autoInject: config.autoInject.get(),
    maxInjected: config.maxInjected.get(),
    importanceThreshold: config.importanceThreshold.get(),
    captureEveryTurns: config.captureEveryTurns.get(),
    captureMaxTurns: config.captureMaxTurns.get(),
    captureMaxChars: config.captureMaxChars.get(),
    captureIncludeAssistant: config.captureIncludeAssistant.get(),
    llmProvider: config.llmProvider.get(),
    llmModel: config.llmModel.get(),
  }
}

/** 当前配置的稳定读取/写入句柄。 */
export interface MemorySettingsAccess {
  /** 当前配置（直接读 Config 的 volatile 引用，始终可用）。 */
  get(): MemoryConfig
  /** 合并写入 profile 条目用户层；settings 服务未就绪时抛错。 */
  update(patch: Partial<MemoryConfig>): Promise<void>
  /** 写入通道是否已就绪（面板可据此提示）。 */
  ready(): boolean
}

/**
 * @param ctx - 插件上下文（用来等 settings 服务）。
 * @param config - 插件 Config（volatile 引用；读取直接现取）。
 * @returns 稳定的读写句柄。
 */
export function installMemorySettings(ctx: Context, config: Config): MemorySettingsAccess {
  let updateFn: ((patch: Partial<MemoryConfig>) => Promise<void>) | undefined
  ctx.inject(['settings'], (settingsCtx) => {
    // 写入本插件 profile 条目：ns = 条目 id，patch 只含 volatile 字段（settings 会校验）。
    updateFn = (patch) => settingsCtx.settings.update(MEMORY_NAMESPACE, patch as object)
    settingsCtx.effect(() => () => { updateFn = undefined })
  })
  return {
    get: () => memoryConfigOf(config),
    ready: () => updateFn !== undefined,
    update: async (patch) => {
      if (updateFn === undefined) throw new Error('配置服务尚未就绪，请稍后再试')
      await updateFn(patch)
    },
  }
}

/**
 * 本插件自带设置页面（settings.section），据此关掉宿主按 schema 自建页面的策略：
 * 可选增强 —— settings 服务缺席（纯 UI 宿主）时本插件照常工作。
 */
export function configureMemorySettingsPage(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
