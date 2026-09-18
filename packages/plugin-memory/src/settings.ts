/**
 * plugin-memory 设置命名空间 `forge-studio-memory`：host 注册 schema + 组合 base。
 *
 * 面板上的「生成对话记忆」开关即 autoCapture；注入相关字段同表，applies: 'live'。
 *
 * 读取走一个稳定的 access 句柄：settings 服务可能晚于本插件就绪（装配是服务可用性
 * 驱动的），句柄在注册完成前返回 schema 默认值（base），注册完成后自动切换为真实
 * 作用域并随 watch 保持同步；写入在注册完成前抛出可读错误。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { MEMORY_CONFIG_BASE, MEMORY_NAMESPACE, type MemoryConfig } from './types.ts'

export { MEMORY_NAMESPACE }
export type { SettingsProvider }

export const MemoryConfigSchema = Schema.object({
  autoCapture: Schema.boolean().default(MEMORY_CONFIG_BASE.autoCapture),
  autoInject: Schema.boolean().default(MEMORY_CONFIG_BASE.autoInject),
  maxInjected: Schema.natural().min(1).max(20).default(MEMORY_CONFIG_BASE.maxInjected),
  importanceThreshold: Schema.natural().min(1).max(5).default(MEMORY_CONFIG_BASE.importanceThreshold),
  captureEveryTurns: Schema.natural().min(1).max(20).default(MEMORY_CONFIG_BASE.captureEveryTurns),
  captureMaxTurns: Schema.natural().min(1).max(24).default(MEMORY_CONFIG_BASE.captureMaxTurns),
  captureMaxChars: Schema.natural().min(500).max(12000).default(MEMORY_CONFIG_BASE.captureMaxChars),
  captureIncludeAssistant: Schema.boolean().default(MEMORY_CONFIG_BASE.captureIncludeAssistant),
})

/** 当前配置的稳定读取/写入句柄。 */
export interface MemorySettingsAccess {
  /** 当前配置；settings 未就绪时返回 base 默认值。 */
  get(): MemoryConfig
  /** 合并写入用户层；settings 未就绪时抛错。 */
  update(patch: Partial<MemoryConfig>): Promise<void>
  /** settings 作用域是否已就绪（面板可据此提示）。 */
  ready(): boolean
}

export function installMemorySettings(ctx: Context): MemorySettingsAccess {
  let current: MemoryConfig = { ...MEMORY_CONFIG_BASE }
  let updateFn: ((patch: Partial<MemoryConfig>) => Promise<void>) | undefined
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(MEMORY_NAMESPACE, MemoryConfigSchema, {
      base: MEMORY_CONFIG_BASE,
      applies: 'live',
    })
    current = scope.get() as MemoryConfig
    updateFn = (patch) => scope.update(patch)
    const dispose = scope.watch((next) => {
      current = next as MemoryConfig
    })
    settingsCtx.effect(() => () => {
      dispose()
      updateFn = undefined
    })
  })
  return {
    get: () => current,
    ready: () => updateFn !== undefined,
    update: async (patch) => {
      if (updateFn === undefined) throw new Error('配置服务尚未就绪，请稍后再试')
      await updateFn(patch)
    },
  }
}
