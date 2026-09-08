/**
 * plugin-daily-log 设置命名空间 `forge-studio-daily-log`：host 注册 schema + 组合 base。
 * 字段对齐原 commit-log-daily 的 author/report/safety（去掉 model——模型路由走宿主）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { DAILY_LOG_NAMESPACE, type DailyLogConfig } from './types.ts'

export { DAILY_LOG_NAMESPACE }
export type { SettingsProvider }

export const DailyLogConfigSchema = Schema.object({
  authorName: Schema.string().default(''),
  authorEmail: Schema.string().default(''),
  outputDir: Schema.string().default(''),
  safeMode: Schema.boolean().default(true),
})

export const DAILY_LOG_CONFIG_BASE: DailyLogConfig = {
  authorName: '',
  authorEmail: '',
  outputDir: '',
  safeMode: true,
}

export function installDailyLogSettings(ctx: Context): void {
  ctx.inject(['settings'], (ctx) => {
    ctx.settings.register(DAILY_LOG_NAMESPACE, DailyLogConfigSchema, {
      base: DAILY_LOG_CONFIG_BASE,
      applies: 'live',
    })
  })
}
