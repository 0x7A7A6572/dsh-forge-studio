/**
 * @zzerx/dsh-plugin-usage-billing/client —— 浏览器入口。
 *
 * 两层 inject：第一层只挂载 `remote` 命名空间，第二层声明 `remote.usageBilling` 之后才注册槽位；
 * 在只声明了 `remote` 的 ctx 上读面，三个槽位会「注册成功、渲染即崩」。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 槽位契约是全局 `SlotMap` 的类型增广，声明方在本包之外；这些 import 全部 type-only
// （无运行时依赖、构建后不残留），但三个包都要写进 devDependencies。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { mountUsageBillingRemote, usageBillingOf } from './core/remote.ts'
import { createQueryCache } from './core/query.ts'
import { createRevalidator } from './core/revalidate.ts'
import { createBillingStore } from './core/store.ts'
import type { BillingConfigLike } from './core/config.ts'
import { EntryCard } from './components/EntryCard.tsx'
import { ComposerEntry } from './components/ComposerEntry.tsx'
import { SettingsSection } from './views/settings-section/SettingsSection.tsx'
import { createThemeRegistry } from './core/theme-registry.ts'
import { createThemeFailureStore } from './core/themes/failures.ts'
import { installThemeLoader } from './hooks/theme-runtime.ts'
import { builtinEntryTheme } from './themes/builtin-entry.tsx'
import { USAGE_BILLING_NAMESPACE } from '../types.ts'

export const name = '@zzerx/dsh-plugin-usage-billing/client'
export const inject = ['slots', 'remote', 'configForms']

// 槽位 id 必须带 `zzerx-` 前缀：`usage-billing` 已被同时挂载的参考插件占用。
export const ENTRY_SLOT_ID = 'zzerx-usage-billing'
export const COMPOSER_SLOT_ID = 'zzerx-usage-billing-composer'
export const SETTINGS_SECTION_ID = 'zzerx-usage-billing'
export const ENTRY_LABEL = '计费'

/**
 * 命名空间从 `../types.ts` 取值，不从 `../settings.ts` 引 —— 后者依赖 schemastery 与 host
 * 代码，client 引入会把 host 实现拖进浏览器产物。`types.ts` 是零依赖模块，两边共用。
 */
export type { BillingConfigLike } from './core/config.ts'

export function apply(ctx: Context): void {
  ctx.inject(['slots', 'remote', 'configForms'], (c) => {
    // 刻意不 await：本层要同步把第二层 inject 登记上，依赖顺序交给 cordis；
    // 提前 await 会把三个注册推到微任务之后，而测试断言 apply 返回时已注册完。
    void mountUsageBillingRemote(c).catch((error: unknown) => {
      c.logger.warn('[usage-billing] 远程命名空间挂载失败', error)
    })
    // 第二层：先声明 `remote.usageBilling` 再读面（cordis 硬要求）。
    c.inject(['remote.usageBilling', 'remote', 'slots', 'configForms'], (d) => {
      // 按 fiber 创建：模块级单例会把上一轮的视图状态带进下一次 apply。
      const store = createBillingStore()
      const scope = d.configForms.get<BillingConfigLike>(USAGE_BILLING_NAMESPACE)
      // 请求合并与重取心跳同样按 fiber 创建：模块级单例会带上上一轮的
      // 定时器与在飞请求。
      const query = createQueryCache()
      const revalidate = createRevalidator({
        source: typeof document === 'undefined' ? undefined : document,
      })
      d.effect(() => () => revalidate.dispose())
      // 设置快照 → store 回灌：只在设置页写、从不回读，重挂后会出现
      // 「勾选框说不含子代理，账里却仍有子代理行」。快照未就绪时保持 store 现值，
      // 绝不先翻成一个猜测再翻回来。
      const syncIncludeSubagents = (): void => {
        const next = scope.getSnapshot().value
        if (next === undefined) return
        store.setIncludeSubagents(next.display?.includeSubagents !== false)
      }
      d.effect(() => { syncIncludeSubagents(); return scope.subscribe(syncIncludeSubagents) })

      // 内置那张先进去：它在 bundle 里、不依赖路由；同 id 时用户主题顶替它。
      const themes = createThemeRegistry()
      themes.register(builtinEntryTheme)
      const failures = createThemeFailureStore()
      const disposeThemes = installThemeLoader({ registry: themes, failures })
      d.effect(() => () => { disposeThemes(); failures.dispose(); themes.dispose() })

      // 槽位 id 分属两个槽，不复用 —— 同一 id 在两个槽里语义会打架。
      d.slots.inject('sidebar.footer.action', () => d.slots.register({
        name: 'sidebar.footer.action',
        id: ENTRY_SLOT_ID,
        order: 10,
        label: ENTRY_LABEL,
        inject: () => ({ billing: usageBillingOf(d), store, scope, query, revalidate, themes }),
      }, EntryCard))

      // sessionId 由框架按 session 作用域解析后作为 inject 的第一个参数传入（侧栏没有）。
      d.slots.inject('conversation.composer.dock', () => d.slots.register({
        name: 'conversation.composer.dock',
        id: COMPOSER_SLOT_ID,
        order: 10,
        label: ENTRY_LABEL,
        inject: (sessionId: string) => ({ billing: usageBillingOf(d), store, scope, sessionId, query, revalidate }),
      }, ComposerEntry))

      d.slots.inject('settings.section', () => d.slots.register({
        name: 'settings.section',
        id: SETTINGS_SECTION_ID,
        order: 40,
        label: ENTRY_LABEL,
        inject: () => ({ billing: usageBillingOf(d), scope, store, query, revalidate, themes, failures }),
      }, SettingsSection))
    })
  })
}
