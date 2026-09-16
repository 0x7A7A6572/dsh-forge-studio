/** 仪表盘浮层（slot: shell.overlay，最小版；Task 21 替换正文）。 */

import { useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'

export function Dashboard(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element | null {
  const { store } = props
  // 必须订阅：入口卡改的是 store 里的 open，不订阅则开合都不会重渲染（hooks 先于早退调用）。
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (!state.open) return null
  return (
    <div data-dsh-usage-billing data-dsh-ub-overlay>
      <section data-dsh-ub-panel role="dialog" aria-label="计费仪表盘">
        <h2 style={{ margin: 0, fontSize: 16 }}>计费</h2>
        <button type="button" onClick={() => store.closePanel()}>关闭</button>
        <div data-dsh-ub-empty>正在读取用量…</div>
      </section>
    </div>
  )
}
