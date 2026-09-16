/**
 * 设置面的最小假实现（jsdom 用例共用）。
 *
 * 宿主真实面是 `SettingsScope`（`getSnapshot` / `subscribe` / `set` / `unset` / `mutate`，
 * 见 @deepseek-ai/dsh-client-ui-settings 的 settings-contract.d.ts）。这里按影子契约
 * `{ get, watch }` 写出来的假件会让组件在浏览器里直接抛错，所以必须对齐真实面。
 *
 * `set` 会把写入**折回快照并通知订阅者**（真实宿主同样会更新镜像）：只有这样才能证明
 * 「写入 → 界面跟随」以及「关闭是一次性的」这类行为，而不是只断言 set 被调过一次。
 *
 * `settle` 打开后 `set` 只在被显式 `resolve` 时才折回快照 —— 用来复现「写入已排队、还没结算」
 * 的窗口（宿主对同一命名空间的写入是排队结算的，这正是两个写者互相覆盖的成因）。
 */

import type { BillingConfigLike, BillingScope } from '../src/client/core/config.ts'

export interface FakeScope {
  scope: BillingScope
  /** 收到的写入（field → value），按调用顺序。 */
  writes: Array<{ field: string; value: unknown }>
  /** 当前快照值（写入后同步更新）。 */
  value(): BillingConfigLike
  /** `settle: true` 时结算第 `i` 次排队中的写入（0 起）；否则是 no-op。 */
  settle(i?: number): Promise<void>
}

export function fakeScope(
  initial: BillingConfigLike,
  opts: { writable?: boolean; settle?: boolean } = {},
): FakeScope {
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
  /** `settle: true` 时：按调用顺序结算「还没折回快照」的写入。 */
  const deferred: Array<() => void> = []
  const commit = (field: string, value: unknown) => {
    snapshot = {
      ...snapshot,
      value: { ...snapshot.value, [field]: value } as BillingConfigLike,
      revision: snapshot.revision + 1,
    }
    for (const l of listeners) l()
  }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (field: string, value: unknown) => {
      writes.push({ field, value })
      // 折回镜像：真实宿主的写入会让下一次 getSnapshot 反映新值。
      if (opts.settle !== true) { commit(field, value); return Promise.resolve() }
      return new Promise<void>((resolve) => {
        deferred.push(() => { commit(field, value); resolve() })
      })
    },
    unset: async () => {},
    mutate: async () => {},
  }
  return {
    scope: scope as unknown as BillingScope,
    writes,
    value: () => snapshot.value,
    /** 结算第 `i` 次排队中的写入（0 起）；未排队就立刻 resolve，让调用方不必猜顺序。 */
    settle: async (i = 0) => { const next = deferred[i] ?? (() => {}); await next() },
  }
}

/** 配置片默认值（与 host `USAGE_BILLING_CONFIG_BASE` 形状一致）。 */
export function baseConfig(over: Partial<BillingConfigLike> = {}): BillingConfigLike {
  return {
    budget: { enabled: false, monthlyCny: 100 },
    display: { showUnpricedWarning: true, includeSubagents: true },
    pricing: { autoRefresh: true, refreshHours: 6 },
    notices: { backfillDismissed: false, budgetNotified: {} },
    ...over,
  }
}
