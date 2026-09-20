/**
 * 便签板主体（BoardMain）的全部状态与派生数据。
 *
 * 数据整理全部走 core/board-filter 纯函数：分区（活动/归档）→ 排序 → 颜色过滤 →
 * 文字搜索；展示做**懒加载**（首批 16 条，底部哨兵进入视口即续批）。视图只读返回值。
 *
 * 视图/筛选/搜索选择存于 board-store（模块级），所以弹窗开关不丢；它们的变更会把
 * 懒加载窗口重置回首批。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { NoteColor, NoteRecord } from '../../../../types.ts'
import type { BoardView } from '../../../core/board-store.ts'
import { boardStore } from '../../../core/board-store.ts'
import {
  partitionNotes,
  filterNotesByColors,
  searchNotes,
  initialWindow,
  nextWindow,
  type LazyWindow,
} from '../../../core/board-filter.ts'

/** BoardMain 需要的 props 子集（数据 + 动作回调）。 */
export interface UseBoardMainOptions {
  readonly notes: readonly NoteRecord[]
  readonly onEdit: (note: NoteRecord) => void
  readonly onTogglePin: (note: NoteRecord) => void
  readonly onToggleArchive: (note: NoteRecord) => void
  readonly onRemove: (note: NoteRecord) => void
}

/** 一行/一卡的四个动作回调（NoteCard / NoteRow 共用）。 */
export interface BoardRowHandlers {
  readonly onEdit: () => void
  readonly onTogglePin: () => void
  readonly onToggleArchive: () => void
  readonly onRemove: () => void
}

export interface UseBoardMainResult {
  readonly view: BoardView
  readonly colors: readonly NoteColor[]
  readonly query: string
  readonly sentinelRef: React.RefObject<HTMLDivElement>
  readonly listScrollRef: React.RefObject<HTMLDivElement>
  readonly activeMatched: readonly NoteRecord[]
  readonly archivedMatched: readonly NoteRecord[]
  readonly activeVisible: readonly NoteRecord[]
  readonly archivedVisible: readonly NoteRecord[]
  readonly archivedOpen: boolean
  readonly remaining: number
  readonly noNotes: boolean
  readonly noMatch: boolean
  readonly loadMore: () => void
  readonly toggleArchived: () => void
  readonly rowHandlers: (note: NoteRecord) => BoardRowHandlers
  readonly setView: (view: BoardView) => void
  readonly setQuery: (query: string) => void
  readonly toggleColor: (color: NoteColor) => void
  readonly clearColors: () => void
}

/** BoardMain 的状态与派生数据。 */
export function useBoardMain(options: UseBoardMainOptions): UseBoardMainResult {
  const view = useSyncExternalStore(boardStore.subscribe, () => boardStore.view)
  const colors = useSyncExternalStore(boardStore.subscribe, () => boardStore.colors)
  const query = useSyncExternalStore(boardStore.subscribe, () => boardStore.query)

  const [win, setWin] = useState<LazyWindow>(initialWindow)
  const [archivedOpen, setArchivedOpen] = useState(false)
  // 底部哨兵：进入视口下沿附近即继续展开懒加载窗口（见下方 effect）。
  const [sentinelInView, setSentinelInView] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // 归档 dock 展开后把列表滚到底所需（列表 div 本身是滚动容器）。
  const listScrollRef = useRef<HTMLDivElement>(null)

  const { active, archived } = useMemo(() => partitionNotes(options.notes), [options.notes])
  const activeMatched = useMemo(
    () => searchNotes(filterNotesByColors(active, colors), query),
    [active, colors, query],
  )
  const archivedMatched = useMemo(() => searchNotes(archived, query), [archived, query])

  // 视图/筛选/搜索变化时，懒加载窗口回到首批。
  useEffect(() => {
    setWin(initialWindow())
    setArchivedOpen(false)
  }, [view, colors, query])

  const activeVisible = useMemo(() => activeMatched.slice(0, win.active), [activeMatched, win.active])
  const archivedVisible = useMemo(
    () => archivedMatched.slice(0, win.archived),
    [archivedMatched, win.archived],
  )

  /** 尚未懒加载显示的条目数（活动区 + 展开中的归档区）。 */
  const remaining =
    activeMatched.length -
    activeVisible.length +
    (archivedOpen ? archivedMatched.length - archivedVisible.length : 0)

  const noNotes = options.notes.length === 0
  const hasFilter = colors.length > 0 || query.trim() !== ''
  const noMatch = hasFilter && activeMatched.length === 0 && archivedMatched.length === 0

  // 底部哨兵观察：宿主外层或列表 div 任意一方滚动到哨兵附近都触发（不依赖
  // 具体哪个容器在滚 —— 旧 onScroll 在首批内容不足一屏时永不触发）。
  useEffect(() => {
    const el = sentinelRef.current
    // jsdom/无 IO 环境静默降级（不自动续批，仍有「加载更多」按钮兜底）。
    if (!el || view === 'lanes' || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setSentinelInView(entry.isIntersecting)
      },
      { root: null, rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [view])

  // 哨兵可见期间逐批展开，直到填满可视区或全部加载完。
  useEffect(() => {
    if (!sentinelInView || view === 'lanes') return
    if (win.active >= activeMatched.length && (!archivedOpen || win.archived >= archivedMatched.length)) {
      return
    }
    setWin((w) =>
      nextWindow(w, { active: activeMatched.length, archived: archivedMatched.length }, archivedOpen),
    )
  }, [sentinelInView, view, win, archivedOpen, activeMatched.length, archivedMatched.length])

  /** 「加载更多」手动兜底：点一次展开一批。 */
  function loadMore(): void {
    setWin((w) =>
      nextWindow(w, { active: activeMatched.length, archived: archivedMatched.length }, archivedOpen),
    )
  }

  /** 展开/收起归档：展开后把列表滚到底，让归档内容直接出现在 dock 条上方。 */
  function toggleArchived(): void {
    setArchivedOpen((open) => {
      if (!open) {
        window.requestAnimationFrame(() => {
          const el = listScrollRef.current
          if (!el) return
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        })
      }
      return !open
    })
  }

  const rowHandlers = (note: NoteRecord): BoardRowHandlers => ({
    onEdit: () => options.onEdit(note),
    onTogglePin: () => options.onTogglePin(note),
    onToggleArchive: () => options.onToggleArchive(note),
    onRemove: () => options.onRemove(note),
  })

  return {
    view,
    colors,
    query,
    sentinelRef,
    listScrollRef,
    activeMatched,
    archivedMatched,
    activeVisible,
    archivedVisible,
    archivedOpen,
    remaining,
    noNotes,
    noMatch,
    loadMore,
    toggleArchived,
    rowHandlers,
    setView: (next) => boardStore.setView(next),
    setQuery: (next) => boardStore.setQuery(next),
    toggleColor: (color) => boardStore.toggleColor(color),
    clearColors: () => boardStore.clearColors(),
  }
}
