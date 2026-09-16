/** 趋势 tab 骨架（Task 22 填充真实实现）。 */

import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'

export function TabTrend(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element {
  void props
  return <div data-dsh-ub-empty>正在读取用量…</div>
}
