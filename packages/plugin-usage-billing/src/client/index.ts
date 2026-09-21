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
 * `slots.inject` / `slots.register` 通过调用 fiber 回收，设置快照订阅则走一条
 * `ctx.effect`（下面 `d.effect`：订阅的 disposer 必须挂在 fiber 上，否则 stop 后订阅泄漏）。
 * 两处回收路径不重叠：`ctx.effect` 只管它自己注册的那条副作用。
 * 样式见 styles/settings-section.module.css，由构建预设的 CSS 插件自动注入，插件不再有手动 injector。
 *
 * **两层 inject**：`remote` 是**按 fiber 声明**的服务面 —— api-gateway 把每个命名空间
 * 注册成独立服务名 `remote.<namespace>`，cordis 只在「读过声明」的 fiber store 里解析它
 * （`vendor/cordis` reflect 的 `fiber.store` 查找，查不到即
 * `cannot get property "remote.usageBilling" without inject`）。所以在只声明了 `remote`
 * 的 ctx 上读面，三个槽位会「注册成功、渲染即崩」。第一层因此只负责挂载命名空间，
 * 第二层声明 `remote.usageBilling` 之后才创建注册。
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
import { createBillingStore } from './core/store.ts'
import type { BillingConfigLike } from './core/config.ts'
import { EntryCard } from './components/EntryCard.tsx'
import { Dashboard } from './views/dashboard/Dashboard.tsx'
import { SettingsSection } from './views/settings-section/SettingsSection.tsx'
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
 * client 的配置片类型面在 `./core/config.ts`（视图与这里共用，避免入口 ↔ 视图成环）。
 */
export type { BillingConfigLike } from './core/config.ts'

export function apply(ctx: Context): void {
  // 第一层：只挂载远程命名空间。注册**不能**留在这一层 —— 本层只声明了 `remote`，
  // 读 `c.remote.usageBilling` 会抛 `cannot get property "remote.usageBilling"
  // without inject`（槽位注册成功、渲染即崩的那个 bug）。
  ctx.inject(['slots', 'remote', 'settingsScope'], (c) => {
    // 这里刻意**不 await** `mountUsageBillingRemote`：本层要同步把第二层 inject 登记上，
    // 由 cordis 在面出现（`$mount` 解析）时激活第二层并同步跑注册 —— 依赖顺序交给
    // Cordis，而不是靠 await 排队。把 await 提到注册之前则会把三个注册推到微任务之后，
    // 而 tests/client-apply.test.ts 断言「apply 返回时已注册完」，实测 2/3 用例红。
    void mountUsageBillingRemote(c).catch((error: unknown) => {
      c.logger.warn('[usage-billing] 远程命名空间挂载失败', error)
    })
    // 第二层：**先声明 `remote.usageBilling` 再读面**（cordis 的硬要求，与 plugin-notes /
    // plugin-memory / plugin-daily-log 同一姿态）。面没出现前本层不会激活，所以三个注册
    // 也不会落在读不到面的 ctx 上；`d` 就是那个声明过面的 ctx，下面一律用它。
    c.inject(['remote.usageBilling', 'remote', 'slots', 'settingsScope'], (d) => {
      // 视图状态按 fiber 创建：模块级单例会在 fiber stop 后把上一轮的
      // open/tab/range 带进下一次 apply（重新挂载的插件不该继承旧弹窗状态）。
      const store = createBillingStore()
      const scope = d.settingsScope.bind<BillingConfigLike>({ namespace: USAGE_BILLING_NAMESPACE })
      // 持久设置 → store 回灌：store 是按 fiber 新建的（`includeSubagents: true`），复选框读的是
      // 设置快照、四个分区读的却是 store。只在设置页「写」而从不「回读」，重新挂载后就会出现
      // 「勾选框说不含子代理，账里却仍有子代理行」——两处口径必须收敛到同一个值。
      // 快照未就绪（`value === undefined`，首帧的常态）时**保持 store 现值**，等真值到达再收敛；
      // 绝不先翻成一个猜测再翻回来。字段缺席（旧 host）按勾选框的默认（含）处理。
      const syncIncludeSubagents = (): void => {
        const next = scope.getSnapshot().value
        if (next === undefined) return
        store.setIncludeSubagents(next.display?.includeSubagents !== false)
      }
      d.effect(() => { syncIncludeSubagents(); return scope.subscribe(syncIncludeSubagents) })

      d.slots.inject('sidebar.footer.action', () => d.slots.register({
        name: 'sidebar.footer.action',
        id: ENTRY_SLOT_ID,
        order: 10,
        label: ENTRY_LABEL,
        inject: () => ({ billing: usageBillingOf(d), store }),
      }, EntryCard))

      d.slots.inject('shell.overlay', () => d.slots.register({
        name: 'shell.overlay',
        id: OVERLAY_SLOT_ID,
        order: 10,
        label: ENTRY_LABEL,
        inject: () => ({ billing: usageBillingOf(d), store, scope }),
      }, Dashboard))

      d.slots.inject('settings.section', () => d.slots.register({
        name: 'settings.section',
        id: SETTINGS_SECTION_ID,
        order: 40,
        label: ENTRY_LABEL,
        inject: () => ({ billing: usageBillingOf(d), scope, store }),
      }, SettingsSection))
    })
  })
}
