/**
 * 设置分区的 client 侧类型面。
 *
 * 放在 core 而不是 `client/index.ts`：`index.ts` 是入口（引用所有视图），视图反过来引
 * 入口就会成环。`BillingConfigLike` 是 client 真正读到的配置片，`BillingScope` 是宿主
 * `settingsScope.bind<BillingConfigLike>` 返回的真实面（`getSnapshot` / `subscribe` / `set`）。
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { EntryKey, EntryPosition } from '../../types.ts'

/** `UsageBillingConfig` 的 client 窄视图：只列本插件读写的字段。 */
export interface BillingConfigLike {
  budget: { enabled: boolean; monthlyCny: number }
  display: {
    showUnpricedWarning: boolean
    includeSubagents: boolean
    /** 旧配置的落点与两个开关都可缺席（首次写入前 / 旧 host 落的配置）。 */
    entryPosition?: EntryPosition
    entrySidebar?: boolean
    entryComposer?: boolean
  }
  pricing: { autoRefresh: boolean; refreshHours: number }
  notices: { backfillDismissed: boolean; budgetNotified: Record<string, string> }
}

export type BillingScope = SettingsScope<BillingConfigLike>

/** `SettingsScopeSnapshot.value` 在首帧可能是 undefined：视图统一按「未就绪」处理。 */
export type BillingConfig = BillingConfigLike | undefined

/** 两个入口的开关状态：各自独立，可只开一处、也可两处都关。 */
export type EntryFlags = Record<EntryKey, boolean>

/**
 * 入口开关的唯一读法。开关写过一个就按开关算（缺的那个按关，不能拿旧落点补齐，
 * 否则「两个都关」会被旧配置翻回一处）；两个都缺席时才翻译旧配置的落点，再缺席回到侧栏。
 */
export function entryFlagsOf(cfg: BillingConfig): EntryFlags {
  const display = cfg?.display
  if (display === undefined) return { sidebar: true, composer: false }
  if (display.entrySidebar !== undefined || display.entryComposer !== undefined) {
    return { sidebar: display.entrySidebar === true, composer: display.entryComposer === true }
  }
  return display.entryPosition === 'composer'
    ? { sidebar: false, composer: true }
    : { sidebar: true, composer: false }
}
