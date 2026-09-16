/**
 * 明细：按工作区下钻到会话 + 按模型（**同名模型跨 provider 一行**，标注混合单价 / 未收录）。
 *
 * 版式：工作区是「一行一卡、点开下钻」的列表（层级关系用缩进表达），
 * 模型是表格（列对齐才好纵向比大小）—— 两件事的数据形状本来就不同。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { backfilledDisclosure, formatCny, formatDateTime, formatInt, isUnpricedTotal } from '../core/format.ts'
import { DataTable } from './components/data-table.tsx'
import type { DataTableColumn } from './components/data-table.tsx'
import { Card } from './components/kit.tsx'
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

  if (data === null) return <div className="ub-empty" data-dsh-ub-empty>正在读取用量…</div>
  const { workspaces, models } = data
  // 趋势 / 热力图都有的空态，明细同样要有（否则是两张空表）。
  if (workspaces.length === 0 && models.length === 0) {
    return <div className="ub-empty" data-dsh-ub-empty>这个范围里还没有用量记录。</div>
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
      ? <span className="ub-unpriced">未收录</span>
      : <>{formatCny(costCny)}</>
  )

  const columns: ReadonlyArray<DataTableColumn<ModelRow>> = [
    {
      key: 'model',
      header: '模型',
      main: true,
      // 同名模型跨 provider 并成一行：provider 一个都不丢，全列出来。
      render: (m) => m.providers.join(' / ') + ' / ' + m.model,
    },
    { key: 'input', header: '输入', align: 'right', render: (m) => formatInt(m.input) },
    { key: 'cacheRead', header: '缓存读', align: 'right', render: (m) => formatInt(m.cacheRead) },
    { key: 'output', header: '输出', align: 'right', render: (m) => formatInt(m.output) },
    {
      key: 'cost',
      header: '费用',
      align: 'right',
      // 未计价行绝不能显示 ¥0.00：那读起来是「免费」。零额 + 未计价时明确写未收录。
      render: (m) => (!m.priced && m.costCny === 0
        ? <span className="ub-unpriced">未收录</span>
        : <>{formatCny(m.costCny)}</>),
    },
    {
      key: 'note',
      header: '备注',
      // 三段都是本单元格的直接文本节点：getByText 才读得到完整备注。
      render: (m) => (!m.priced ? '未收录 · ' : '')
        + (m.mixedRate ? '混合单价 · ' : '')
        + (m.rawModels.length > 1 ? `${m.rawModels.length} 个原始 id` : ''),
    },
  ]

  return (
    <div className="ub-section" data-dsh-usage-billing>
      {hasBackfilled ? (
        <p className="ub-sub" data-dsh-ub-estimate>
          含安装前估算 · 安装前的历史用量按安装时点价表估算，可能与实际账单不一致。
        </p>
      ) : null}

      <Card title="按工作区" desc="点一行展开到会话（子代理会话单独标注）。">
        <div className="ub-list">
          {workspaces.map((w) => {
            const open = expanded === w.cwd
            return (
              <div className="ub-item" key={w.cwd}>
                <button
                  type="button"
                  className="ub-item-head"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : w.cwd)}
                >
                  <span className="ub-item-title">{w.cwd}</span>
                  <span className="ub-item-meta">
                    {rowMoney(w.costCny)} · {formatInt(w.calls)} 次
                  </span>
                </button>
                {open ? (
                  <div className="ub-item-body">
                    {w.sessions.map((s) => (
                      <div className="ub-item-body-line" key={s.sessionId}>
                        <span className="ub-item-body-path">{s.sessionId}</span>
                        <span>
                          {' · '}{rowMoney(s.costCny)} · {formatInt(s.calls)} 次 · 最后活跃{' '}
                          {formatDateTime(s.lastTime)}
                        </span>
                        {s.isSubagent ? <span className="ub-item-meta">{' · 子代理'}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="按模型">
        <DataTable columns={columns} rows={models} rowKey={(m) => m.key} empty="这个范围里还没有按模型的用量。" />
      </Card>
    </div>
  )
}
