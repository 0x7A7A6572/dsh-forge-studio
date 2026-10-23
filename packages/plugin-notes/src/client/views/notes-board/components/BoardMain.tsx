/**
 * 便签板主体：工具条（视图页签 / 搜索 / 颜色筛选 / 新建）+ 三种显示模式 + 归档折叠区。
 * grid 纸卡墙走便签语义（纸色即底色，懒加载）；lanes 看板与 calendar 月历走工单语义。
 * 数据整理全在 core/board-filter 与 core/calendar-month，本文件只有 JSX。
 */

import type { NoteId, NoteRecord } from '../../../../types.ts'
import type { TaskStatus } from '../../../core/task-lanes.ts'
import { t } from '../../../core/theme-tokens.ts'
import { useBoardMain } from './useBoardMain.ts'
import { CalendarBoard } from './CalendarBoard.tsx'
import { NoteCard } from '../../../components/NoteCard.tsx'
import { TaskLanes } from '../../../components/TaskLanes.tsx'
import { ColorFilter } from '../../../components/ColorFilter.tsx'
import { EmptyState } from '../../../components/EmptyState.tsx'
import {
  Archive,
  CalendarDays,
  ChevronRight,
  Kanban,
  LayoutGrid,
  ListFilter,
  Plus,
  Search,
  SearchX,
  X,
} from 'lucide-react'
import styles from '../../../styles/notes-board.module.css'

export interface BoardMainProps {
  readonly notes: readonly NoteRecord[]
  readonly busy: boolean
  readonly onEdit: (note: NoteRecord) => void
  readonly onTogglePin: (note: NoteRecord) => void
  readonly onToggleArchive: (note: NoteRecord) => void
  readonly onRemove: (note: NoteRecord) => void
  readonly onCreate: () => void
  /** 任务看板：拖拽换列（落 notes.update({ lane: { status } })）。 */
  readonly onMove: (noteId: NoteId, status: TaskStatus) => void
  /** 任务看板：执行/重跑（非 running 卡主入口）。 */
  readonly onExecute: (note: NoteRecord) => void
  /** 任务看板：重置为待办（running 卡主入口，手动接管）。 */
  readonly onReset: (note: NoteRecord) => void
  /** 任务看板：列头「＋」新建任务（初始 lane.status = 列状态）。 */
  readonly onCreateTask: (status: TaskStatus) => void
  /** 看板卡片：设置/清除截止日期（驱动日历排格）。 */
  readonly onSetDue: (note: NoteRecord, dueAt: number | undefined) => void
  /** 看板卡片：定时 chip 点击切换启停。 */
  readonly onToggleSchedule: (note: NoteRecord) => void
}

const VIEW_TABS = [
  { view: 'grid', label: '纸卡墙', Icon: LayoutGrid },
  { view: 'lanes', label: '看板', Icon: Kanban },
  { view: 'calendar', label: '日历', Icon: CalendarDays },
] as const

export function BoardMain(props: BoardMainProps): JSX.Element {
  const {
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
    filterOpen,
    remaining,
    noNotes,
    noMatch,
    loadMore,
    toggleArchived,
    toggleFilter,
    rowHandlers,
    setView,
    setQuery,
    toggleColor,
    clearColors,
  } = useBoardMain(props)

  return (
    <>
      <div style={toolbarStyle}>
        <div role="tablist" aria-label="视图切换" style={tabListStyle}>
          {VIEW_TABS.map(({ view: id, label, Icon }) => {
            const active = view === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={styles.tab}
                style={tabStyle(active)}
                onClick={() => setView(id)}
              >
                <Icon size={13} />
                {label}
              </button>
            )
          })}
        </div>

        <span style={{ flex: 1 }} />

        {!noNotes && (
          <div className={styles.searchRow} style={searchRowStyle}>
            <Search size={14} style={{ flex: 'none', color: t.labelTertiary }} />
            <input
              value={query}
              placeholder="搜索标题或正文…"
              aria-label="搜索便签"
              onChange={(e) => setQuery(e.target.value)}
              style={searchInput}
            />
            {query !== '' && (
              <button
                type="button"
                title="清除搜索"
                aria-label="清除搜索"
                className={styles.searchClear}
                style={clearBtn}
                onClick={() => setQuery('')}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {!noNotes && (
          <button
            type="button"
            title="按颜色筛选"
            aria-label="按颜色筛选"
            aria-pressed={filterOpen || colors.length > 0}
            className={styles.tool}
            style={iconToggle(colors.length > 0)}
            onClick={toggleFilter}
          >
            <ListFilter size={14} />
            {colors.length > 0 && <span style={filterCount}>{colors.length}</span>}
          </button>
        )}

        <button
          type="button"
          className={styles.tool}
          style={{ ...btnPrimary, ...(props.busy ? disabledStyle : {}) }}
          disabled={props.busy}
          onClick={props.onCreate}
        >
          <Plus size={14} /> 新建便签
        </button>
      </div>

      {!noNotes && filterOpen && (
        <div style={filterRowStyle}>
          <ColorFilter colors={colors} onToggle={toggleColor} onClear={clearColors} />
        </div>
      )}

      <div ref={listScrollRef} style={view === 'calendar' ? calendarAreaStyle : listStyle}>
        {view === 'calendar' ? (
          noNotes ? (
            <EmptyState onCreate={props.onCreate} />
          ) : (
            <CalendarBoard notes={activeMatched} onEdit={props.onEdit} />
          )
        ) : view === 'lanes' ? (
          // 看板全量渲染（列内自带滚动），归档便签不进列、只在底部提示。
          noNotes ? (
            <EmptyState onCreate={props.onCreate} />
          ) : (
            <>
              {activeMatched.length === 0 ? (
                <div style={zoneEmptyStyle}>
                  <SearchX size={15} style={{ opacity: 0.7 }} />
                  <span>
                    {noMatch
                      ? '没有匹配的便签'
                      : archivedMatched.length > 0
                        ? '没有活动便签（已归档见下方提示）'
                        : '没有活动便签'}
                  </span>
                </div>
              ) : (
                <TaskLanes
                  notes={activeMatched}
                  busy={props.busy}
                  onEdit={props.onEdit}
                  onTogglePin={props.onTogglePin}
                  onToggleArchive={props.onToggleArchive}
                  onRemove={props.onRemove}
                  onMove={props.onMove}
                  onExecute={props.onExecute}
                  onReset={props.onReset}
                  onCreateTask={props.onCreateTask}
                  onSetDue={props.onSetDue}
                  onToggleSchedule={props.onToggleSchedule}
                />
              )}
              {archivedMatched.length > 0 && (
                <div style={archivedHintStyle}>
                  <span>已归档 {archivedMatched.length} 条 · 归档便签不进看板</span>
                  <button type="button" style={clearFilterBtn} onClick={() => setView('grid')}>
                    去纸卡墙管理
                  </button>
                </div>
              )}
            </>
          )
        ) : noNotes ? (
          <EmptyState onCreate={props.onCreate} />
        ) : (
          <>
            <ul style={gridStyle}>
              {activeVisible.map((note) => (
                <NoteCard key={note.id} note={note} busy={props.busy} {...rowHandlers(note)} />
              ))}
            </ul>

            {activeMatched.length === 0 && (
              <div style={zoneEmptyStyle}>
                <SearchX size={15} style={{ opacity: 0.7 }} />
                <span>
                  {noMatch
                    ? '没有匹配的便签'
                    : archivedMatched.length > 0
                      ? '没有活动便签（已归档见下方）'
                      : '没有活动便签'}
                </span>
              </div>
            )}

            {archivedOpen && archivedMatched.length > 0 && (
              <section style={archivedBodyStyle} aria-label="已归档便签">
                <ul style={gridStyle}>
                  {archivedVisible.map((note) => (
                    <NoteCard key={note.id} note={note} busy={props.busy} {...rowHandlers(note)} />
                  ))}
                </ul>
              </section>
            )}

            {noMatch && (
              <div style={noMatchStyle}>
                <span>试试：</span>
                {query.trim() !== '' && (
                  <button type="button" style={clearFilterBtn} onClick={() => setQuery('')}>
                    清除搜索「{query.trim()}」
                  </button>
                )}
                {colors.length > 0 && (
                  <button type="button" style={clearFilterBtn} onClick={clearColors}>
                    清除颜色筛选
                  </button>
                )}
              </div>
            )}

            {remaining > 0 && (
              <div style={loadMoreRowStyle}>
                <span style={loadMoreHint}>还有 {remaining} 条未显示</span>
                <button type="button" style={loadMoreBtn} onClick={loadMore}>
                  加载更多
                </button>
              </div>
            )}
            <div ref={sentinelRef} aria-hidden="true" style={sentinelStyle} />
          </>
        )}
      </div>

      {view === 'grid' && archivedMatched.length > 0 && (
        <button
          type="button"
          aria-expanded={archivedOpen}
          onClick={toggleArchived}
          style={archivedDockStyle}
        >
          <Archive size={14} style={{ flex: 'none', color: t.labelSecondary }} />
          <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
            已归档（{archivedMatched.length}）
          </span>
          <ChevronRight
            size={14}
            style={{
              flex: 'none',
              color: t.labelTertiary,
              transform: archivedOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 140ms ease',
            }}
          />
        </button>
      )}
    </>
  )
}

/* ---------- 样式（内联几何 + 主题令牌；hover/动效在 notes-board.module.css） ---------- */

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  rowGap: 6,
  flexWrap: 'wrap',
  padding: '8px 16px 6px',
  flex: 'none',
}
const tabListStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  flex: 'none',
}
const tabStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 28,
  padding: '0 10px',
  border: 'none',
  borderRadius: 8,
  fontSize: 12.5,
  cursor: 'pointer',
  color: active ? t.labelPrimary : t.labelSecondary,
  // 只有选中态写死背景：非选中留空，hover 才吃得进 CSS（内联会盖掉 :hover）。
  ...(active ? { background: t.surfaceRaised, fontWeight: 600 } : {}),
})
const searchRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 10px',
  height: 30,
  width: 210,
  flex: '0 1 210px',
  minWidth: 96,
  boxSizing: 'border-box',
  border: `1px solid ${t.borderL2}`,
  borderRadius: 9,
  background: 'transparent',
}
const searchInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 12.5,
  color: t.labelPrimary,
}
const clearBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  padding: 0,
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  color: t.labelTertiary,
  cursor: 'pointer',
}
const iconToggle = (on: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  color: on ? t.labelPrimary : t.labelSecondary,
  background: on ? t.surfaceRaised : 'transparent',
})
const filterCount: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1,
  color: t.labelSecondary,
}
const filterRowStyle: React.CSSProperties = {
  padding: '2px 16px 6px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 'none',
}
const listStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '4px 16px 16px',
}
/** 日历自己管高度：外层不滚，避免月网格叠出双层滚动条。 */
const calendarAreaStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  padding: '2px 16px 12px',
  display: 'flex',
  flexDirection: 'column',
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
const zoneEmptyStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '24px 0',
  color: t.labelTertiary,
  fontSize: 13,
}
/** 看板底部的归档提示行（归档便签不进看板）。 */
const archivedHintStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  flexWrap: 'wrap',
  padding: '10px 4px 2px',
  color: t.labelCaption,
  fontSize: 12.5,
}
const noMatchStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '36px 0',
  color: t.labelTertiary,
  fontSize: 13,
  flexWrap: 'wrap',
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
const loadMoreRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '14px 0 4px',
}
const loadMoreHint: React.CSSProperties = {
  color: t.labelCaption,
  fontSize: 12.5,
}
const loadMoreBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 14px',
  border: 'none',
  borderRadius: 14,
  fontSize: 12.5,
  lineHeight: 1,
  cursor: 'pointer',
  color: t.onPrimary,
  background: t.primaryFill,
  fontWeight: 600,
}
const sentinelStyle: React.CSSProperties = { height: 1 }
/** 归档内容块（滚动区内、dock 条上方）。 */
const archivedBodyStyle: React.CSSProperties = {
  marginTop: 20,
  borderTop: `1px dashed ${t.borderL2}`,
  paddingTop: 20,
}
/** 底部常驻「已归档」dock 条：列表在它上方滚动，永远可见可点。 */
const archivedDockStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 16px 8px',
  border: 'none',
  borderTop: `1px solid ${t.borderL2}`,
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 12.5,
  color: t.labelSecondary,
  flex: 'none',
}
const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 30,
  padding: '0 13px',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1,
  cursor: 'pointer',
  color: t.onPrimary,
  background: t.primaryFill,
  fontWeight: 600,
  flex: 'none',
}
const disabledStyle: React.CSSProperties = { opacity: 0.45, cursor: 'default' }
