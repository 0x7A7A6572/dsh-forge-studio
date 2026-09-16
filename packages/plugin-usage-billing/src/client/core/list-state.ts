/**
 * 列表的过滤 / 排序 / 分页（纯函数）。
 *
 * 宿主 UI 原语里**没有** Table / List / Pagination（已核对 lib/types/index.d.ts 的全部导出：
 * 只有 Button / Pill / Tag / Switch / Input / Menu / Modal / Tooltip / HoverCard / JsonTree
 * 与一堆代码块组件 —— 没有任何表格或分页）。宿主自己的列表页（plugin-inventory、
 * archived-sessions）也只做了「搜索框 + filter」，没有分页。
 * shadcn-ui 需要 Tailwind（本仓库与 DSH 宿主都没有 Tailwind），所以这一层按 shadcn 的
 * **架构**来写：数据与渲染分离、无样式结构 + 走设计 token 的样式，只是不引 Tailwind。
 * 这里是纯逻辑那一半，换个 UI 库也不用重写。
 */

export interface SortState { key: string; dir: 'asc' | 'desc' }

/** 归一化查询：去首尾空白 + 大小写不敏感。 */
export function normalizeQuery(input: string): string {
  return input.trim().toLowerCase()
}

/** 一行是否命中查询。空查询恒命中（不是「不显示」）。 */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeQuery(query)
  return q === '' || haystack.toLowerCase().includes(q)
}

/**
 * 按某列排序。`value` 由调用方给（列的取值方式各不相同）。
 *
 * 非有限数字（NaN / Infinity，界面上的「未收录」占位）一律沉底：它们既不是「大」也不是
 * 「小」，按自然顺序排会占据榜首，反而把真正的大额挤下去。
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null,
  value: (row: T, key: string) => number | string,
): T[] {
  if (sort === null) return [...rows]
  const factor = sort.dir === 'desc' ? -1 : 1
  // 沉底哨兵：升序时当成 +∞、降序时当成 -∞ —— 两种方向都落到末尾。
  // （只写成 -∞ 的话升序会把「未收录」排到最前面，正好是它最不该占的位置。）
  const sink = sort.dir === 'desc' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  return [...rows].sort((a, b) => {
    const av = value(a, sort.key)
    const bv = value(b, sort.key)
    if (typeof av === 'number' && typeof bv === 'number') {
      const an = Number.isFinite(av) ? av : sink
      const bn = Number.isFinite(bv) ? bv : sink
      if (an === bn) return 0
      return an < bn ? -factor : factor
    }
    return String(av).localeCompare(String(bv), 'zh-Hans-CN') * factor
  })
}

export const PAGE_SIZES = [10, 20, 50] as const

export type PageSize = (typeof PAGE_SIZES)[number]

export function pageCount(total: number, size: number): number {
  if (!(size > 0)) return 1
  return Math.max(1, Math.ceil(total / size))
}

/** 夹紧页码：过滤后行数变少时必须回落，否则会停在一张空表上。 */
export function clampPage(page: number, total: number, size: number): number {
  if (!Number.isFinite(page) || page < 1) return 1
  return Math.min(Math.floor(page), pageCount(total, size))
}

export function pageRows<T>(rows: readonly T[], page: number, size: number): T[] {
  const p = clampPage(page, rows.length, size)
  const start = (p - 1) * size
  return rows.slice(start, start + size)
}

export interface ListView<T> {
  rows: T[]
  total: number
  filtered: number
  page: number
  size: number
  pages: number
}

/** 一次把「过滤 → 排序 → 分页」跑完：三处列表用的是同一段逻辑，不各写一遍。 */
export function buildListView<T>(props: {
  rows: readonly T[]
  query: string
  searchText?: (row: T) => string
  sort: SortState | null
  sortValue: (row: T, key: string) => number | string
  page: number
  size: number
}): ListView<T> {
  const { rows, query, searchText, sort, sortValue, size } = props
  const filtered = searchText === undefined
    ? [...rows]
    : rows.filter((row) => matchesQuery(searchText(row), query))
  const sorted = sortRows(filtered, sort, sortValue)
  const page = clampPage(props.page, sorted.length, size)
  return {
    rows: pageRows(sorted, page, size),
    total: rows.length,
    filtered: sorted.length,
    page,
    size,
    // 分页器的页数按 filtered 算：过滤后只剩 3 行时，「第 2 页」不该还存在。
    pages: pageCount(sorted.length, size),
  }
}
