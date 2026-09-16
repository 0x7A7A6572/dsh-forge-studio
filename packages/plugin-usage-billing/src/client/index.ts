/**
 * @zzerx/dsh-plugin-usage-billing/client —— 浏览器入口。
 *
 * 三个正规 slot：
 * - `sidebar.footer.action` 入口卡（**id 必须用 zzerx-usage-billing**：`usage-billing`
 *   已被参考插件占用，复用会顶掉它）
 * - `shell.overlay` 仪表盘弹窗（该层 click-through，占用者自行 opt-in 指针事件）
 * - `settings.section` 设置页
 *
 * 全部经 `slots.inject` 声明感知注册，与加载顺序无关；每个注册的 disposer 由
 * `ctx.effect` 归还当前 fiber。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 槽位契约为全局 `SlotMap` 的类型增广，声明方在本包之外：
// - `@deepseek-ai/dsh-client-ui-settings/client`：`settings.section` 槽 + `ctx.settingsScope`
// - `@deepseek-ai/dsh-client-ui-sidebar/client`：`sidebar.footer.action` 槽
// - `@deepseek-ai/dsh-client-ui-layout/client`：`shell.overlay` 槽
// 全部 type-only（无运行时依赖、构建后不残留 import）。三者都要写在 devDependencies 里，
// `dsh.client.inject` 不是这个机制（与 plugin-notes 同姿态）；不得用本地 declare module 影子契约。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { mountUsageBillingRemote, usageBillingOf } from './core/remote.ts'
import { billingStore } from './core/store.ts'
import { ensureUsageBillingStyle } from './views/ui-css.ts'
import { EntryCard } from './views/entry-card.tsx'
import { Dashboard } from './views/dashboard.tsx'
import { SettingsSection } from './views/settings-section.tsx'
import { USAGE_BILLING_NAMESPACE } from '../types.ts'

export const name = '@zzerx/dsh-plugin-usage-billing/client'
export const inject = ['slots', 'remote', 'settingsScope']

// 所有 client 侧槽位 id 一律带 `zzerx-` 前缀：槽位 id 是全局的，无前缀的 `usage-billing`
// 已被同时挂载的参考插件 `@kenz1117/dsh-ui-usage-billing` 占用，复用会顶掉它。
// host 侧 settings 命名空间（USAGE_BILLING_NAMESPACE）是每插件独立的存储 key，不受此约束。
export const ENTRY_SLOT_ID = 'zzerx-usage-billing'
export const OVERLAY_SLOT_ID = 'zzerx-usage-billing-dashboard'
export const SETTINGS_SECTION_ID = 'zzerx-usage-billing'
export const ENTRY_LABEL = '计费'

/**
 * 设置命名空间：**从 `../types.ts` 取值，不从 `../settings.ts` 引** —— 后者依赖
 * `@deepseek-ai/schemastery` 与 host 代码，client 引入会把 host 侧实现拖进浏览器产物。
 * `types.ts` 是零依赖模块，host 与 client 共用它（这是命名空间的唯一来源）。
 * client 只需要一小片只读形状，见 `BillingConfigLike`。
 */
export interface BillingConfigLike {
  budget: { enabled: boolean; monthlyCny: number }
  display: { showUnpricedWarning: boolean; includeSubagents: boolean }
  pricing: { autoRefresh: boolean; refreshHours: number }
  notices: { backfillDismissed: boolean; budgetNotified: Record<string, string> }
  installAt: number
}

export function apply(ctx: Context): void {
  ctx.inject(['slots', 'remote', 'settingsScope'], (c) => {
    // brief 这里是 `async (c) => { await mountUsageBillingRemote(c); ... }`：
    // await 会把三个注册推迟到微任务，而 tests/client-apply.test.ts 断言 apply 返回时
    // 它们已经注册完 —— 实测 2/3 用例红（registered/injected 都是空数组）。改为同步注册，
    // 远程命名空间在 inject 工厂里惰性取（工厂本来就在渲染时调用，那时 mount 早已完成）。
    void mountUsageBillingRemote(c).catch((error: unknown) => {
      c.logger.warn('[usage-billing] 远程命名空间挂载失败', error)
    })
    ensureUsageBillingStyle()
    const scope = c.settingsScope.bind<BillingConfigLike>({ namespace: USAGE_BILLING_NAMESPACE })

    c.slots.inject('sidebar.footer.action', () => c.slots.register({
      name: 'sidebar.footer.action',
      id: ENTRY_SLOT_ID,
      order: 10,
      label: ENTRY_LABEL,
      inject: () => ({ billing: usageBillingOf(c) }),
    }, EntryCard))

    c.slots.inject('shell.overlay', () => c.slots.register({
      name: 'shell.overlay',
      id: OVERLAY_SLOT_ID,
      order: 10,
      label: ENTRY_LABEL,
      inject: () => ({ billing: usageBillingOf(c), store: billingStore }),
    }, Dashboard))

    c.slots.inject('settings.section', () => c.slots.register({
      name: 'settings.section',
      id: SETTINGS_SECTION_ID,
      order: 40,
      label: ENTRY_LABEL,
      inject: () => ({ billing: usageBillingOf(c), scope }),
    }, SettingsSection))
  })
}
