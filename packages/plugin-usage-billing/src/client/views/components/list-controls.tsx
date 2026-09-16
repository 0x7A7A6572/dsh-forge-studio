/**
 * 标准列表的三件套：过滤框 / 排序表头 / 分页器，外加一个把三者串起来的 hook。
 *
 * 为什么自己写：宿主原语里**没有** Table / List / Pagination（已核对
 * `@deepseek-ai/dsh-client-ui-primitives` 的全部导出）。shadcn-ui 需要 Tailwind，
 * 而本仓库与 DSH 宿主都没有 Tailwind —— 它的 Table/Pagination 本体也只是「无样式结构 +
 * 样式类」，所以这里按同样的架构实现：结构无样式、样式全走 ub- 类名与设计 token，
 * 逻辑抽在 core/list-state.ts（纯函数，可单测）。
 *
 * 一个刻意的取舍：**只有一个匹配项时立刻显示它**。搜索框不做「回车才筛」，也不做延迟 ——
 * 这些表最多几百行，实时过滤没有性能问题，少一次交互。
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { PAGE_SIZES, buildListView } from '../../core/list-state.ts'
import type { ListView, PageSize, SortState } from '../../core/list-state.ts'

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

export function ListToolbar(props: {
  query: string
  onQuery: (query: string) => void
  placeholder?: string
  total: number
  filtered: number
  children?: ReactNode
}): JSX.Element {
  const placeholder = props.placeholder ?? '过滤…'
  return (
    <div className="ub-listbar" data-dsh-ub-listbar>
      <Input
        className="ub-input-sm ub-search"
        icon={<Search size={14} />}
        value={props.query}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => { props.onQuery(event.currentTarget.value) }}
      />
      <span className="ub-listbar-count" data-dsh-ub-count>
        {props.filtered === props.total
          ? '共 ' + props.total + ' 条'
          : '共 ' + props.total + ' 条 · 命中 ' + props.filtered + ' 条'}
      </span>
      {props.children === undefined ? null : (
        <span className="ub-listbar-extra">{props.children}</span>
      )}
    </div>
  )
}

export function ListPager(props: {
  page: number
  pages: number
  size: PageSize
  onPage: (page: number) => void
  onSize: (size: PageSize) => void
}): JSX.Element | null {
  // 只有一页时不渲染分页器：行数本来就少，摆一排禁用的箭头只是噪音
  //（「共 N 条」已经由工具条负责说了）。
  if (props.pages <= 1) return null
  return (
    <div className="ub-pager" data-dsh-ub-pager>
      <span className="ub-pager-sizes" role="group" aria-label="每页条数">
        {PAGE_SIZES.map((size) => (
          <Pill
            key={size}
            active={size === props.size}
            aria-label={'每页 ' + size + ' 条'}
            onClick={() => { props.onSize(size) }}
          >
            {String(size)}
          </Pill>
        ))}
      </span>
      <span className="ub-pager-nav">
        <Button
          variant="ghost" size="sm" icon={<ChevronLeft size={14} />}
          disabled={props.page <= 1}
          onClick={() => { props.onPage(props.page - 1) }}
        >
          上一页
        </Button>
        <span className="ub-pager-pos" data-dsh-ub-page>
          {props.page} / {props.pages}
        </span>
        <Button
          variant="ghost" size="sm" icon={<ChevronRight size={14} />}
          disabled={props.page >= props.pages}
          onClick={() => { props.onPage(props.page + 1) }}
        >
          下一页
        </Button>
      </span>
    </div>
  )
}
