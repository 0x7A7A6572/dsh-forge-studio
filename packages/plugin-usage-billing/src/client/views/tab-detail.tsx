/** 明细：按工作区下钻到会话 + 按模型（provider/canonical model 分行，标注混合单价/未收录）。 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { backfilledDisclosure, formatCny, formatDateTime, formatInt, isUnpricedTotal } from '../core/format.ts'
import type { ModelRow, WorkspaceRow } from '../../view.ts'

/** 金额与披露标记同源：都来自同一次 byWorkspace / byModel 响应。 */
interface DetailPayload {
  workspaces: WorkspaceRow[]
  models: ModelRow[]
  hasBackfilled: boolean
  /** byWorkspace 响应自带的未收录清单（与金额同源）——「一行都没定价」的唯一判据要用它。 */
  unpricedModels: string[]
}

export function TabDetail(props: {
  billing: UsageBillingRemote | undefined
  store: BillingStore
}): JSX.Element {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [data, setData] = useState<DetailPayload | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (billing === undefined) return
    let alive = true
    // 两个响应各自自带披露标记；任何一个为 present 都按 present 披露（或起来 = 保守）。
    void Promise.all([
      billing.byWorkspace(state.range, state.includeSubagents),
      billing.byModel(state.range, state.includeSubagents),
    ]).then(([w, m]) => {
      if (!alive) return
      // 两份数据都必须到达才渲染：任一缺席时页面停在「正在读取用量…」，
      // 于是不存在「有金额、标记却未知」的中间态（披露只会多，不会少）。
      if (w.ok && m.ok) {
        setData({
          workspaces: w.value.workspaces,
          models: m.value.models,
          hasBackfilled: w.value.hasBackfilled || m.value.hasBackfilled,
          // 宽松 codec 透传：旧 host 可能没有这个字段，缺省按「没有未收录模型」处理。
          unpricedModels: w.value.unpricedModels ?? [],
        })
      } else {
        // 任一失败都停在「正在读取用量…」并留下日志，绝不伪造金额。
        if (!w.ok) console.warn('[usage-billing] 工作区取数失败', w.error)
        if (!m.ok) console.warn('[usage-billing] 模型取数失败', m.error)
      }
    }).catch((error: unknown) => {
      // wire 层 reject（Promise.all 整体失败）：同样保持占位，不制造 unhandled rejection。
      console.warn('[usage-billing] 明细通道异常', error)
    })
    return () => { alive = false }
  }, [billing, state.range, state.includeSubagents])

  if (data === null) return <div data-dsh-ub-empty>正在读取用量…</div>
  const { workspaces, models } = data
  // 趋势 / 热力图都有的空态，明细同样要有（此前这里是两张空表）。
  if (workspaces.length === 0 && models.length === 0) {
    return <div data-dsh-ub-empty>这个范围里还没有用量记录。</div>
  }
  const hasBackfilled = backfilledDisclosure(data.hasBackfilled)
  // 与下面模型表同一条「未计价行不写 ¥0.00」的规则：整份账一行都没定价时（唯一判据
  // isUnpricedTotal），工作区 / 会话这些金额列里的 0 同样是未知 —— 写「未收录」而不是 ¥0.00。
  const unpriced = isUnpricedTotal(
    workspaces.reduce((sum, w) => sum + w.costCny, 0),
    data.unpricedModels,
  )
  const rowMoney = (costCny: number): JSX.Element => (
    unpriced && costCny === 0
      ? <span data-dsh-ub-estimate>未收录</span>
      : <>{formatCny(costCny)}</>
  )

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
              {w.cwd} · {rowMoney(w.costCny)} · {formatInt(w.calls)} 次
            </button>
            {expanded === w.cwd ? (
              <ul data-dsh-ub-sub>
                {w.sessions.map((s) => (
                  <li key={s.sessionId}>
                    {s.sessionId} · {rowMoney(s.costCny)} · {formatInt(s.calls)} 次 · 最后活跃 {formatDateTime(s.lastTime)}
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
