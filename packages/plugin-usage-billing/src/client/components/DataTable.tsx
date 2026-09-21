/**
 * 通用表格：过滤框 + 可排序表头 + 分页器。
 *
 * 宿主原语里没有 Table（primitives 的全部导出里只有 Button / Pill / Tag / Switch / Input /
 * Menu / Modal / Tooltip / HoverCard / JsonTree 等，没有任何表格或分页组件），
 * 所以这里是本插件唯一的表格实现，三个列表（逐日明细 / 按模型 / 生效价目）共用它。
 *
 * 语义与可达性按标准表格来：`<th scope="col">`、`aria-sort`、排序是一个真按钮
 * （键盘可点、读屏会念「按 X 排序」）、空态占满一整行而不是留一张空表。
 */
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useList } from '../hooks/useList.ts'
import type { SortState } from '../core/list-state.ts'
import { ListPager } from './ListPager.tsx'
import { ListToolbar } from './ListToolbar.tsx'
import styles from '../styles/settings-section.module.css'

export interface TableColumn<T> {
  key: string
  header: string
  /** 数字列右对齐（配合 tabular-nums 才能对齐小数点）。 */
  align?: 'left' | 'right'
  /** 主列：这一行「是什么」，字重更重。 */
  main?: boolean
  /** 给出来就代表这一列可排序（点击表头循环 升 → 降 → 原始）。 */
  sortValue?: (row: T) => number | string
  render: (row: T) => ReactNode
}

function SortMark({ dir }: { dir: 'asc' | 'desc' | null }): JSX.Element {
  if (dir === 'asc') return <ArrowUp size={12} aria-hidden="true" />
  if (dir === 'desc') return <ArrowDown size={12} aria-hidden="true" />
  return <ChevronsUpDown size={12} aria-hidden="true" />
}

export function DataTable<T>(props: {
  columns: readonly TableColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  /** 给出来才显示过滤框：把一行的可搜索文本拼出来（通常就是几列的文字）。 */
  searchText?: (row: T) => string
  filterPlaceholder?: string
  defaultSort?: SortState
  className?: string
}): JSX.Element {
  const { columns, rows } = props
  const list = useList<T>({
    rows,
    searchText: props.searchText,
    // 列的取值方式由列自己给；没给就不能排到这一列（toggleSort 也不会被触发）。
    sortValue: (row, key) => columns.find((column) => column.key === key)?.sortValue?.(row) ?? '',
    defaultSort: props.defaultSort,
  })

  const cellClass = (column: TableColumn<T>): string =>
    [column.align === 'right' ? styles.num : '', column.main === true ? styles.cellMain : '']
      .filter((part) => part !== '').join(' ')

  return (
    <div className={props.className === undefined ? undefined : props.className}>
      {props.searchText === undefined ? null : (
        <ListToolbar
          query={list.query}
          onQuery={list.setQuery}
          placeholder={props.filterPlaceholder}
          total={list.view.total}
          filtered={list.view.filtered}
        />
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table} data-dsh-ub-table>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = list.sort !== null && list.sort.key === column.key
                const dir = active ? list.sort!.dir : null
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.align === 'right' ? styles.num : undefined}
                    aria-sort={column.sortValue === undefined ? undefined
                      : dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                  >
                    {column.sortValue === undefined ? column.header : (
                      <button
                        type="button"
                        className={styles.thSort}
                        aria-label={'按' + column.header + '排序'}
                        onClick={() => { list.toggleSort(column.key) }}
                      >
                        {column.header}
                        <SortMark dir={dir} />
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {list.view.rows.map((row) => (
              <tr key={props.rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>{column.render(row)}</td>
                ))}
              </tr>
            ))}
            {list.view.rows.length === 0 ? (
              <tr>
                <td className={styles.tableEmpty} colSpan={columns.length}>
                  {rows.length === 0 ? (props.empty ?? '还没有记录。') : '没有匹配的记录。'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ListPager
        page={list.view.page}
        pages={list.view.pages}
        size={list.size}
        onPage={list.setPage}
        onSize={list.setSize}
      />
    </div>
  )
}
