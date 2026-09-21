/**
 * 明细页的取数与列表状态：按工作区下钻到会话 + 按模型
 * （**同名模型跨 provider 一行**，标注混合单价 / 未收录）。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { BillingStore } from '../../core/store.ts'
import { useList } from '../../hooks/useList.ts'
import type { ListController } from '../../hooks/useList.ts'
import type { ModelRow, WorkspaceRow } from '../../../view.ts'

/**
 * 过滤/排序的取值函数放模块级：身份稳定，列表的 memo 才不会每帧重算
 * （每次渲染现造闭包，等于把 memo 关掉）。
 */
const workspaceSearch = (w: WorkspaceRow): string =>
  w.cwd + ' ' + w.sessions.map((s) => s.sessionId).join(' ')

const workspaceSort = (w: WorkspaceRow, key: string): number | string => {
  if (key === 'calls') return w.calls
  if (key === 'cost') return w.costCny
  return w.cwd
}

/** 数据到达前的空列表：模块级常量，保证身份稳定。 */
const NO_WORKSPACES: readonly WorkspaceRow[] = []

/** 金额与披露标记同源：都来自同一次 byWorkspace / byModel 响应。 */
export interface DetailPayload {
  workspaces: WorkspaceRow[]
  models: ModelRow[]
  hasBackfilled: boolean
  /** byWorkspace 响应自带的未收录清单（与金额同源）——「一行都没定价」的唯一判据要用它。 */
  unpricedModels: string[]
}

export interface TabDetailProps {
  billing: UsageBillingRemote | undefined
  store: BillingStore
}

export interface TabDetailState {
  data: DetailPayload | null
  expanded: string | null
  toggleExpanded: (cwd: string) => void
  workspaceList: ListController<WorkspaceRow>
}

export function useTabDetail(props: TabDetailProps): TabDetailState {
  const { billing, store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [data, setData] = useState<DetailPayload | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // 两个列表的过滤/排序/分页状态必须无条件声明（hook 顺序不能随数据到达而变）。
  const workspaceList = useList<WorkspaceRow>({
    rows: data?.workspaces ?? NO_WORKSPACES,
    searchText: workspaceSearch,
    sortValue: workspaceSort,
    // 默认按费用从高到低：先看花钱最多的地方。
    defaultSort: { key: 'cost', dir: 'desc' },
  })

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

  const toggleExpanded = useCallback((cwd: string) => {
    setExpanded((current) => (current === cwd ? null : cwd))
  }, [])

  return { data, expanded, toggleExpanded, workspaceList }
}
