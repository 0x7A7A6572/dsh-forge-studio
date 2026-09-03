/**
 * 便签板主体视图（board-overlay 内容区）：工具栏（提示/视图切换/新建）+
 * 颜色筛选行 + 活动便签（grid 纸卡墙或行式列表）+ 底部归档折叠区。
 *
 * 数据整理全部走 core/board-filter 纯函数：分区（活动/归档）→ 排序 → 颜色过滤。
 * - 筛选只作用于活动区；归档区默认收起、展开才渲染，且不受颜色筛选影响；
 * - grid 视图保留 maxVisibleNotes 上限语义，行式列表展示全部活动便签；
 * - 视图选择与颜色筛选存于 board-store（模块级），开关浮层不丢。
 */

import { useMemo, useSyncExternalStore } from 'react'
import type { NoteRecord } from '../../types.ts'
import { boardStore } from '../core/board-store.ts'
import { partitionNotes, filterNotesByColors } from '../core/board-filter.ts'
import { t } from '../core/theme-tokens.ts'
import { NoteCard, CARD_CSS } from '../components/note-card.tsx'
import { NoteRow, ROW_CSS } from '../components/note-row.tsx'
import { ColorFilter, FILTER_CSS } from '../components/color-filter.tsx'
import { ArchivedSection, ARCHIVED_CSS } from '../components/archived-section.tsx'
import { EmptyState } from '../components/empty-state.tsx'
import { LayoutGrid, Plus, Rows3, SearchX } from 'lucide-react'

export interface BoardMainProps {
  readonly notes: readonly NoteRecord[]
  readonly busy: boolean
  readonly maxVisibleNotes?: number
  readonly onEdit: (note: NoteRecord) => void
  readonly onTogglePin: (note: NoteRecord) => void
  readonly onToggleArchive: (note: NoteRecord) => void
  readonly onRemove: (note: NoteRecord) => void
  readonly onCreate: () => void
}

/** board-main 覆盖的所有类选择器样式（统一注入一次）。 */
const BOARD_CSS = `${CARD_CSS}${ROW_CSS}${FILTER_CSS}${ARCHIVED_CSS}`

export function BoardMain(props: BoardMainProps): JSX.Element {
  const view = useSyncExternalStore(boardStore.subscribe, () => boardStore.view)
  const colors = useSyncExternalStore(boardStore.subscribe, () => boardStore.colors)

  const { active, archived } = useMemo(() => partitionNotes(props.notes), [props.notes])
  const filtered = useMemo(() => filterNotesByColors(active, colors), [active, colors])
  const visible = useMemo(() => {
    if (view !== 'grid') return filtered
    const max = props.maxVisibleNotes ?? filtered.length
    return filtered.slice(0, max)
  }, [view, filtered, props.maxVisibleNotes])

  const noNotes = props.notes.length === 0
  const noActiveMatch = filtered.length === 0

  const capHint =
    view === 'grid' && props.maxVisibleNotes !== undefined && filtered.length > props.maxVisibleNotes

  const rowHandlers = (note: NoteRecord) => ({
    onEdit: () => props.onEdit(note),
    onTogglePin: () => props.onTogglePin(note),
    onToggleArchive: () => props.onToggleArchive(note),
    onRemove: () => props.onRemove(note),
  })

  return (
    <>
      <style>{BOARD_CSS}</style>

      <div style={toolbarStyle}>
        <span style={hintStyle}>
          {noNotes
            ? ''
            : noActiveMatch
              ? `颜色筛选无结果 · 共 ${active.length} 条活动便签`
              : capHint
                ? `置顶优先 · 仅显示前 ${props.maxVisibleNotes} 条（设置中可调）`
                : '置顶优先 · 最近更新在前'}
        </span>
        <span style={{ flex: 1 }} />
        <div role="group" aria-label="视图切换" style={viewGroup}>
          <button type="button" title="行式列表" aria-label="行式列表" aria-pressed={view === 'list'}
            style={viewBtn(view === 'list')} onClick={() => boardStore.setView('list')}>
            <Rows3 size={15} />
          </button>
          <button type="button" title="纸卡墙" aria-label="纸卡墙" aria-pressed={view === 'grid'}
            style={viewBtn(view === 'grid')} onClick={() => boardStore.setView('grid')}>
            <LayoutGrid size={15} />
          </button>
        </div>
        <button type="button" style={{ ...btnPrimary, ...(props.busy ? disabledStyle : {}) }} disabled={props.busy}
          onClick={props.onCreate}>
          <Plus size={14} /> 新建便签
        </button>
      </div>

      {!noNotes && (
        <div style={filterRowStyle}>
          <ColorFilter colors={colors} onToggle={(c) => boardStore.toggleColor(c)} onClear={() => boardStore.clearColors()} />
        </div>
      )}

      <div style={listStyle}>
        {noNotes ? (
          <EmptyState onCreate={props.onCreate} />
        ) : (
          <>
            {view === 'grid' ? (
              <ul style={gridStyle}>
                {visible.map((note) => (
                  <NoteCard key={note.id} note={note} busy={props.busy} {...rowHandlers(note)} />
                ))}
              </ul>
            ) : (
              <ul style={rowListStyle}>
                {visible.map((note) => (
                  <NoteRow key={note.id} note={note} busy={props.busy} {...rowHandlers(note)} />
                ))}
              </ul>
            )}

            {noActiveMatch && (
              <div style={noMatchStyle}>
                <SearchX size={16} style={{ opacity: 0.7 }} />
                <span>
                  {colors.length > 0
                    ? '没有符合所选颜色的活动便签'
                    : archived.length > 0
                      ? '没有活动便签（全部已归档）'
                      : '没有活动便签'}
                </span>
                {colors.length > 0 && (
                  <button type="button" style={clearFilterBtn} onClick={() => boardStore.clearColors()}>
                    清除颜色筛选
                  </button>
                )}
              </div>
            )}

            <ArchivedSection
              count={archived.length}
              renderContent={() =>
                view === 'grid' ? (
                  <ul style={gridStyle}>
                    {archived.map((note) => (
                      <NoteCard key={note.id} note={note} busy={props.busy} {...rowHandlers(note)} />
                    ))}
                  </ul>
                ) : (
                  <ul style={rowListStyle}>
                    {archived.map((note) => (
                      <NoteRow key={note.id} note={note} busy={props.busy} {...rowHandlers(note)} />
                    ))}
                  </ul>
                )
              }
            />
          </>
        )}
      </div>
    </>
  )
}

/* ---------- 样式 ---------- */

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px 4px',
}
const hintStyle: React.CSSProperties = {
  color: t.labelCaption,
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const viewGroup: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 9,
  background: t.hoverBg,
}
const viewBtn = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 7,
  cursor: 'pointer',
  color: active ? t.labelPrimary : t.labelSecondary,
  background: active ? t.surfaceRaised : 'transparent',
})
const filterRowStyle: React.CSSProperties = {
  padding: '6px 16px 0',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}
const listStyle: React.CSSProperties = {
  overflow: 'auto',
  padding: '6px 16px 16px',
}
const gridStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(225px, 1fr))',
  gap: 12,
  alignItems: 'stretch',
}
const rowListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}
const noMatchStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '36px 0',
  color: t.labelTertiary,
  fontSize: 13,
}
const clearFilterBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 24,
  padding: '0 10px',
  border: 'none',
  borderRadius: 12,
  fontSize: 12,
  color: t.labelPrimary,
  background: t.hoverBg,
  cursor: 'pointer',
}
const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 30,
  padding: '0 13px',
  border: 'none',
  borderRadius: 15,
  fontSize: 13,
  lineHeight: 1,
  cursor: 'pointer',
  color: t.onPrimary,
  background: t.primaryFill,
  fontWeight: 600,
  flex: 'none',
}
const disabledStyle: React.CSSProperties = { opacity: 0.45, cursor: 'default' }
