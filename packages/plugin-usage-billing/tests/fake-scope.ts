/**
 * 设置面的最小假实现（jsdom 用例共用）。
 *
 * 宿主真实面是 `SettingsScope`（`getSnapshot` / `subscribe` / `set` / `unset` / `mutate`，
 * 见 @deepseek-ai/dsh-client-ui-settings 的 settings-contract.d.ts）。这里按影子契约
 * `{ get, watch }` 写出来的假件会让组件在浏览器里直接抛错，所以必须对齐真实面。
 *
 * `set` 会把写入**折回快照并通知订阅者**（真实宿主同样会更新镜像）：只有这样才能证明
 * 「写入 → 界面跟随」以及「关闭是一次性的」这类行为，而不是只断言 set 被调过一次。
 */

import type { BillingConfigLike, BillingScope } from '../src/client/core/config.ts'

export interface FakeScope {
  scope: BillingScope
  /** 收到的写入（field → value），按调用顺序。 */
  writes: Array<{ field: string; value: unknown }>
  /** 当前快照值（写入后同步更新）。 */
  value(): BillingConfigLike
}

export function fakeScope(initial: BillingConfigLike, opts: { writable?: boolean } = {}): FakeScope {
  let snapshot = {
    status: 'ready' as const,
    value: initial,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: opts.writable ?? true,
    mode: 'host' as const,
  }
  const listeners = new Set<() => void>()
  const writes: Array<{ field: string; value: unknown }> = []
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (field: string, value: unknown) => {
      writes.push({ field, value })
      // 折回镜像：真实宿主的写入会让下一次 getSnapshot 反映新值。
      snapshot = {
        ...snapshot,
        value: { ...snapshot.value, [field]: value } as BillingConfigLike,
        revision: snapshot.revision + 1,
      }
      for (const l of listeners) l()
    },
    unset: async () => {},
    mutate: async () => {},
  }
  return { scope: scope as unknown as BillingScope, writes, value: () => snapshot.value }
}

/** 配置片默认值（与 host `USAGE_BILLING_CONFIG_BASE` 形状一致）。 */
export function baseConfig(over: Partial<BillingConfigLike> = {}): BillingConfigLike {
  return {
    budget: { enabled: false, monthlyCny: 100 },
    display: { showUnpricedWarning: true, includeSubagents: true },
    pricing: { autoRefresh: true, refreshHours: 6 },
    notices: { backfillDismissed: false, budgetNotified: {} },
    installAt: 1_700_000_000_000,
    ...over,
  }
}
