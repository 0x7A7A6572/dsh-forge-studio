import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'

export function Dashboard(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element | null {
  if (!props.store.open) return null
  return (
    <div data-dsh-usage-billing data-dsh-ub-overlay>
      <section data-dsh-ub-panel role="dialog" aria-label="计费仪表盘">
        <h2 style={{ margin: 0, fontSize: 16 }}>计费</h2>
        <button type="button" onClick={() => props.store.closePanel()}>关闭</button>
        <div data-dsh-ub-empty>正在读取用量…</div>
      </section>
    </div>
  )
}
