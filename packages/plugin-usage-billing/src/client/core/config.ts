/**
 * 设置分区的 client 侧类型面。
 *
 * 放在 core 而不是 `client/index.ts`：`index.ts` 是入口（引用所有视图），视图反过来引
 * 入口就会成环。`BillingConfigLike` 是 client 真正读到的配置片，`BillingScope` 是宿主
 * `settingsScope.bind<BillingConfigLike>` 返回的真实面（`getSnapshot` / `subscribe` / `set`）。
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** `UsageBillingConfig` 的 client 窄视图：只列本插件读写的字段。 */
export interface BillingConfigLike {
  budget: { enabled: boolean; monthlyCny: number }
  display: { showUnpricedWarning: boolean; includeSubagents: boolean }
  pricing: { autoRefresh: boolean; refreshHours: number }
  notices: { backfillDismissed: boolean; budgetNotified: Record<string, string> }
  installAt: number
}

export type BillingScope = SettingsScope<BillingConfigLike>

/** `SettingsScopeSnapshot.value` 在首帧可能是 undefined：视图统一按「未就绪」处理。 */
export type BillingConfig = BillingConfigLike | undefined
