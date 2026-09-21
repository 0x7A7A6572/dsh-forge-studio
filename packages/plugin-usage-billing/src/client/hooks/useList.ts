/**
 * 标准列表的状态：过滤 / 排序 / 分页，三件事一起用，所以合一个 hook。
 *
 * 为什么自己写：宿主原语里**没有** Table / List / Pagination（已核对
 * `@deepseek-ai/dsh-client-ui-primitives` 的全部导出）。shadcn-ui 需要 Tailwind，
 * 而本仓库与 DSH 宿主都没有 Tailwind —— 它的 Table/Pagination 本体也只是「无样式结构 +
 * 样式类」，所以这里按同样的架构实现：结构无样式、样式走设计 token，
 * 逻辑抽在 core/list-state.ts（纯函数，可单测）。
 */
import { useMemo, useState } from 'react'
import { buildListView } from '../core/list-state.ts'
import type { ListView, PageSize, SortState } from '../core/list-state.ts'

export interface ListController<T> {
  query: string
  setQuery: (query: string) => void
  sort: SortState | null
  /** 升序 → 降序 → 取消（回到原始顺序）。 */
  toggleSort: (key: string) => void
  setPage: (page: number) => void
  size: PageSize
  setSize: (size: PageSize) => void
  view: ListView<T>
}

export function useList<T>(props: {
  rows: readonly T[]
  searchText?: (row: T) => string
  sortValue: (row: T, key: string) => number | string
  defaultSort?: SortState
  defaultSize?: PageSize
}): ListController<T> {
  const [query, setQueryRaw] = useState('')
  const [sort, setSort] = useState<SortState | null>(props.defaultSort ?? null)
  const [page, setPage] = useState(1)
  const [size, setSizeRaw] = useState<PageSize>(props.defaultSize ?? 10)

  const view = useMemo(() => buildListView({
    rows: props.rows,
    query,
    searchText: props.searchText,
    sort,
    sortValue: props.sortValue,
    page,
    size,
  }), [props.rows, props.searchText, props.sortValue, query, sort, page, size])

  return {
    query,
    // 改查询/改每页条数都要回到第 1 页：否则会停在一个已经不存在的页码上（空表）。
    setQuery: (next: string) => { setQueryRaw(next); setPage(1) },
    sort,
    toggleSort: (key: string) => {
      setSort((current) => {
        if (current === null || current.key !== key) return { key, dir: 'asc' }
        if (current.dir === 'asc') return { key, dir: 'desc' }
        return null
      })
    },
    setPage,
    size,
    setSize: (next: PageSize) => { setSizeRaw(next); setPage(1) },
    view,
  }
}
