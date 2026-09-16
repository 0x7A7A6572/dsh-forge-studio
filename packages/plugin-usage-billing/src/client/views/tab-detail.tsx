/** 明细：按工作区下钻到会话 + 按模型（provider/canonical model 分行，标注混合单价/未收录）。 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { formatCny, formatDateTime, formatInt } from '../core/format.ts'
import type { ModelRow, WorkspaceRow } from '../../view.ts'

export function TabDetail(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null)
  const [models, setModels] = useState<ModelRow[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // 常驻回填标记（不可关）：明细里的金额同样是按安装时点价表估算过的账。
  const [hasBackfilled, setHasBackfilled] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      billing.byWorkspace(state.range, state.includeSubagents),
      billing.byModel(state.range, state.includeSubagents),
      billing.overview(state.range, state.includeSubagents),
    ]).then(([w, m, o]) => {
      if (!alive) return
      if (w.ok) setWorkspaces(w.value.workspaces)
      if (m.ok) setModels(m.value.models)
      if (o.ok) setHasBackfilled(o.value.overview.hasBackfilled)
    })
    return () => { alive = false }
  }, [billing, state.range, state.includeSubagents])

  if (workspaces === null || models === null) return <div data-dsh-ub-empty>正在读取用量…</div>

  return (
    <div data-dsh-usage-billing>
      {hasBackfilled ? (
        <p data-dsh-ub-estimate>
          含安装前估算 · 安装前的历史用量按安装时点价表估算，可能与实际账单不一致。
        </p>
      ) : null}
      <h3 style={{ fontSize: 13 }}>按工作区</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {workspaces.map((w) => (
          <li key={w.cwd}>
            <button type="button" onClick={() => setExpanded(expanded === w.cwd ? null : w.cwd)}>
              {w.cwd} · {formatCny(w.costCny)} · {formatInt(w.calls)} 次
            </button>
            {expanded === w.cwd ? (
              <ul data-dsh-ub-sub>
                {w.sessions.map((s) => (
                  <li key={s.sessionId}>
                    {s.sessionId} · {formatCny(s.costCny)} · {formatInt(s.calls)} 次 · 最后活跃 {formatDateTime(s.lastTime)}
                    {s.isSubagent ? ' · 子代理' : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 style={{ fontSize: 13 }}>按模型</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr data-dsh-ub-sub>
            <th align="left">模型</th><th align="right">输入</th><th align="right">缓存读</th>
            <th align="right">输出</th><th align="right">费用</th><th align="left">备注</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.key}>
              <td>{m.provider} / {m.model}</td>
              <td align="right">{formatInt(m.input)}</td>
              <td align="right">{formatInt(m.cacheRead)}</td>
              <td align="right">{formatInt(m.output)}</td>
              {/* 未计价行绝不能显示 ¥0.00：那读起来是「免费」。零额 + 未计价时明确写未收录。 */}
              <td align="right">
                {!m.priced && m.costCny === 0
                  ? <span data-dsh-ub-estimate>未收录</span>
                  : formatCny(m.costCny)}
              </td>
              <td data-dsh-ub-sub>
                {!m.priced ? '未收录 · ' : ''}
                {m.mixedRate ? '混合单价 · ' : ''}
                {m.rawModels.length > 1 ? `${m.rawModels.length} 个原始 id` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
