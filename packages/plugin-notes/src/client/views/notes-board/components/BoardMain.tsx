/**
 * 便签板主体视图（NotesBoard 内容区）：工具栏（显示模式切换/新建）+
 * 搜索行 + 颜色筛选行 + 活动便签 + 底部归档折叠区。
 *
 * 三种显示模式：
 * - grid：纸卡墙（默认） / list：行式列表 —— 数据整理全部走 core/board-filter
 *   纯函数（分区 → 排序 → 颜色过滤 → 文字搜索），展示做懒加载；
 * - lanes：任务泳道 —— 五列状态看板，纸色即状态（core/task-lanes 派生），
 *   活动便签全量渲染；颜色筛选行在泳道下隐藏（列本身已按色分列，语义冲突）；
 *   归档便签不进泳道（已离开工作流），底部以细提示行引导切列表视图管理。
 *
 * 本文件只有 JSX：状态与派生数据在 useBoardMain（同目录）。
 */

import type { NoteId, NoteRecord } from '../../../../types.ts'
import type { TaskStatus } from '../../../core/task-lanes.ts'
import { t } from '../../../core/theme-tokens.ts'
import { useBoardMain } from './useBoardMain.ts'
import { NoteCard } from '../../../components/NoteCard.tsx'
import { NoteRow } from '../../../components/NoteRow.tsx'
import { TaskLanes } from '../../../components/TaskLanes.tsx'
import { ColorFilter } from '../../../components/ColorFilter.tsx'
import { EmptyState } from '../../../components/EmptyState.tsx'
import {
  Archive,
  ChevronRight,
  Kanban,
  LayoutGrid,
  Plus,
  Rows3,
  Search,
  SearchX,
  X,
} from "lucide-react";
import styles from '../../../styles/notes-board.module.css'

export interface BoardMainProps {
  readonly notes: readonly NoteRecord[];
  readonly busy: boolean;
  readonly onEdit: (note: NoteRecord) => void;
  readonly onTogglePin: (note: NoteRecord) => void;
  readonly onToggleArchive: (note: NoteRecord) => void;
  readonly onRemove: (note: NoteRecord) => void;
  readonly onCreate: () => void;
  /** 任务泳道：拖拽换列（目标状态→纸色由 NotesBoard 落 notes.update）。 */
  readonly onMove: (noteId: NoteId, status: TaskStatus) => void;
  /** 任务泳道：执行/重跑（非 running 卡主入口）。 */
  readonly onExecute: (note: NoteRecord) => void;
  /** 任务泳道：重置为待办（running 卡主入口，手动接管）。 */
  readonly onReset: (note: NoteRecord) => void;
  /** 任务泳道：列头「＋」新建任务（初始 lane.status = 列状态）。 */
  readonly onCreateTask: (status: TaskStatus) => void;
}

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
    remaining,
    noNotes,
    noMatch,
    loadMore,
    toggleArchived,
    rowHandlers,
    setView,
    setQuery,
    toggleColor,
    clearColors,
  } = useBoardMain(props)

  return (
    <>
      <div style={toolbarStyle}>
        {!noNotes && (
          <div className={styles.searchRow} style={searchRowStyle}>
            <Search
              size={14}
              style={{ flex: "none", color: t.labelTertiary }}
            />
            <input
              value={query}
              placeholder="搜索标题或正文…"
              aria-label="搜索便签"
              onChange={(e) => setQuery(e.target.value)}
              style={searchInput}
            />
            {query !== "" && (
              <button
                type="button"
                title="清除搜索"
                aria-label="清除搜索"
                className={styles.searchClear}
                style={clearBtn}
                onClick={() => setQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        <span style={{ flex: 1 }} />
        <div role="group" aria-label="视图切换" style={viewGroup}>
          <button
            type="button"
            title="纸卡墙"
            aria-label="纸卡墙"
            aria-pressed={view === "grid"}
            className={styles.tool}
            style={viewBtn(view === "grid")}
            onClick={() => setView("grid")}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            title="任务泳道"
            aria-label="任务泳道"
            aria-pressed={view === "lanes"}
            className={styles.tool}
            style={viewBtn(view === "lanes")}
            onClick={() => setView("lanes")}
          >
            <Kanban size={15} />
          </button>
          <button
            type="button"
            title="行式列表"
            aria-label="行式列表"
            aria-pressed={view === "list"}
            className={styles.tool}
            style={viewBtn(view === "list")}
            onClick={() => setView("list")}
          >
            <Rows3 size={15} />
          </button>
        </div>
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

      {!noNotes && view !== "lanes" && (
        <div style={filterRowStyle}>
          <ColorFilter
            colors={colors}
            onToggle={toggleColor}
            onClear={clearColors}
          />
        </div>
      )}

      <div ref={listScrollRef} style={listStyle}>
        {view === "lanes" ? (
          // 任务泳道：活动便签按列全量渲染（不做懒加载分批，列内自带滚动）；
          // 颜色筛选行已在上面隐藏；归档便签不进泳道，底部细提示行引导切列表。
          noNotes ? (
            <EmptyState onCreate={props.onCreate} />
          ) : (
            <>
              {activeMatched.length === 0 ? (
                <div style={zoneEmptyStyle}>
                  <SearchX size={15} style={{ opacity: 0.7 }} />
                  <span>
                    {noMatch
                      ? "没有匹配的便签"
                      : archivedMatched.length > 0
                        ? "没有活动便签（已归档见下方提示）"
                        : "没有活动便签"}
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
                />
              )}
              {archivedMatched.length > 0 && (
                <div style={archivedHintStyle}>
                  <span>
                    已归档 {archivedMatched.length} 条 · 归档便签不进任务泳道
                  </span>
                  <button
                    type="button"
                    style={clearFilterBtn}
                    onClick={() => setView("list")}
                  >
                    去列表视图管理
                  </button>
                </div>
              )}
            </>
          )
        ) : noNotes ? (
          <EmptyState onCreate={props.onCreate} />
        ) : (
          <>
            {view === "grid" ? (
              <ul style={gridStyle}>
                {activeVisible.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    busy={props.busy}
                    {...rowHandlers(note)}
                  />
                ))}
              </ul>
            ) : (
              <ul style={rowListStyle}>
                {activeVisible.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    busy={props.busy}
                    {...rowHandlers(note)}
                  />
                ))}
              </ul>
            )}

            {activeMatched.length === 0 && (
              <div style={zoneEmptyStyle}>
                <SearchX size={15} style={{ opacity: 0.7 }} />
                <span>
                  {noMatch
                    ? "没有匹配的便签"
                    : archivedMatched.length > 0
                      ? "没有活动便签（已归档见下方）"
                      : "没有活动便签"}
                </span>
              </div>
            )}

            {archivedOpen && archivedMatched.length > 0 && (
              <section style={archivedBodyStyle} aria-label="已归档便签">
                {view === "grid" ? (
                  <ul style={gridStyle}>
                    {archivedVisible.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        busy={props.busy}
                        {...rowHandlers(note)}
                      />
                    ))}
                  </ul>
                ) : (
                  <ul style={rowListStyle}>
                    {archivedVisible.map((note) => (
                      <NoteRow
                        key={note.id}
                        note={note}
                        busy={props.busy}
                        {...rowHandlers(note)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}

            {noMatch && (
              <div style={noMatchStyle}>
                <span>试试：</span>
                {query.trim() !== "" && (
                  <button
                    type="button"
                    style={clearFilterBtn}
                    onClick={() => setQuery("")}
                  >
                    清除搜索「{query.trim()}」
                  </button>
                )}
                {colors.length > 0 && (
                  <button
                    type="button"
                    style={clearFilterBtn}
                    onClick={clearColors}
                  >
                    清除颜色筛选
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {view !== "lanes" && !noNotes && remaining > 0 && (
          <div style={loadMoreRowStyle}>
            <span style={loadMoreHint}>还有 {remaining} 条未显示</span>
            <button type="button" style={loadMoreBtn} onClick={loadMore}>
              加载更多
            </button>
          </div>
        )}
        {view !== "lanes" && (
          <div ref={sentinelRef} aria-hidden="true" style={sentinelStyle} />
        )}
      </div>
      {view !== "lanes" && archivedMatched.length > 0 && (
        <button
          type="button"
          aria-expanded={archivedOpen}
          onClick={toggleArchived}
          style={archivedDockStyle}
        >
          <Archive size={14} style={{ flex: "none", color: t.labelSecondary }} />
          <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
            已归档（{archivedMatched.length}）
          </span>
          <ChevronRight
            size={14}
            style={{
              flex: "none",
              color: t.labelTertiary,
              transform: archivedOpen ? "rotate(90deg)" : "none",
              transition: "transform 140ms ease",
            }}
          />
        </button>
      )}
    </>
  );
}

/* ---------- 样式（内联几何 + 主题令牌；hover/动效在 notes-board.module.css） ---------- */

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px 4px",
};
const viewGroup: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: 2,
  borderRadius: 9,
  background: t.hoverBg,
};
const viewBtn = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 24,
  padding: 0,
  border: "none",
  borderRadius: 7,
  cursor: "pointer",
  color: active ? t.labelPrimary : t.labelSecondary,
  background: active ? t.surfaceRaised : "transparent",
});
const searchRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 10px",
  height: 32,
  minWidth: "50%",
  boxSizing: "border-box",
  border: `1px solid ${t.borderL2}`,
  borderRadius: 9,
  background: "transparent",
};
const searchInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: 13,
  color: t.labelPrimary,
};
const clearBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  padding: 0,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: t.labelTertiary,
  cursor: "pointer",
};
const filterRowStyle: React.CSSProperties = {
  padding: "8px 16px",
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const listStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  padding: "6px 16px 16px",
};
const gridStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(225px, 1fr))",
  gap: 12,
  alignItems: "stretch",
};
const rowListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const zoneEmptyStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "24px 0",
  color: t.labelTertiary,
  fontSize: 13,
};
/** 泳道模式底部的归档提示行（归档便签不进泳道）。 */
const archivedHintStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  flexWrap: "wrap",
  padding: "10px 4px 2px",
  color: t.labelCaption,
  fontSize: 12.5,
};
const noMatchStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "36px 0",
  color: t.labelTertiary,
  fontSize: 13,
  flexWrap: "wrap",
};
const clearFilterBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 24,
  padding: "0 10px",
  border: "none",
  borderRadius: 12,
  fontSize: 12,
  color: t.labelPrimary,
  background: t.hoverBg,
  cursor: "pointer",
};
const loadMoreRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "14px 0 4px",
};
const loadMoreHint: React.CSSProperties = {
  color: t.labelCaption,
  fontSize: 12.5,
};
const loadMoreBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  padding: "0 14px",
  border: "none",
  borderRadius: 14,
  fontSize: 12.5,
  lineHeight: 1,
  cursor: "pointer",
  color: t.onPrimary,
  background: t.primaryFill,
  fontWeight: 600,
};
const sentinelStyle: React.CSSProperties = { height: 1 };
/** 归档内容块（滚动区内、dock 条上方）。 */
const archivedBodyStyle: React.CSSProperties = {
  marginTop: 20,
  borderTop: `1px dashed ${t.borderL2}`,
  paddingTop: 20,
};
/** 底部常驻「已归档」dock 条：列表在它上方滚动，永远可见可点。 */
const archivedDockStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 16px 8px",
  border: "none",
  borderTop: `1px solid ${t.borderL2}`,
  background: "transparent",
  cursor: "pointer",
  fontSize: 12.5,
  color: t.labelSecondary,
  flex: "none",
};
const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 30,
  padding: "0 13px",
  border: "none",
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1,
  cursor: "pointer",
  color: t.onPrimary,
  background: t.primaryFill,
  fontWeight: 600,
  flex: "none",
};
const disabledStyle: React.CSSProperties = { opacity: 0.45, cursor: "default" };
