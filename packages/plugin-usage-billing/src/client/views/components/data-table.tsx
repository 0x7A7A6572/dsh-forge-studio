/**
 * 数据表 —— primitives 里**没有** Table 原语（只有 Button / Input / Pill / Tag / …），
 * 所以这是本插件里唯一的一份表格实现：明细与费率两页共用它，不再各自手写 <table>。
 *
 * 只做语义正确的最小抽象：<table> 的语义（表头 / 行列 / 屏幕阅读器）必须保留 ——
 * 用 div 拼「表格」会让行列表读不出来。数字列走 `.ub-num`（右对齐 + 等宽数字）。
 */

import type { ReactNode } from 'react'

export interface DataTableColumn<T> {
  /** 稳定 key（React 用，不进 DOM）。 */
  key: string
  /** 表头文案（已经本地化）。 */
  header: string
  /** 数字列传 'right'：右对齐 + 等宽数字，便于纵向比大小。 */
  align?: 'left' | 'right'
  /** 主列（模型名 / 工作区路径）加一点字重，其余列保持常规。 */
  main?: boolean
  render: (row: T, index: number) => ReactNode
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[]
  rows: readonly T[]
  /** 行 key 由调用方给：插值 index 会让「删掉一行」时 React 复用错行的 DOM。 */
  rowKey: (row: T, index: number) => string
  /** 空数据文案；不传则由调用方自己渲染空态。 */
  empty?: string
  /** 表格容器额外类（例如费率页要贴边）。 */
  className?: string
}

export function DataTable<T>(props: DataTableProps<T>): JSX.Element {
  const { columns, rows } = props
  if (rows.length === 0 && props.empty !== undefined) {
    return <div className="ub-table-empty">{props.empty}</div>
  }
  return (
    <div className={props.className === undefined ? 'ub-table-wrap' : 'ub-table-wrap ' + props.className}>
      <table className="ub-table" data-dsh-ub-table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === 'right' ? 'ub-num' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={props.rowKey(row, index)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={column.align === 'right'
                    ? 'ub-num'
                    : column.main === true ? 'ub-cell-main' : undefined}
                >
                  {column.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
