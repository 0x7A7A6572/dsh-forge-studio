/**
 * 便签板主体视图（board-view 内容区）：工具栏（提示/显示模式切换/新建）+
 * 搜索行 + 颜色筛选行 + 活动便签 + 底部归档折叠区。
 *
 * 三种显示模式（board-store 记忆，模块级）：
 * - grid：纸卡墙（默认） / list：行式列表 —— 数据整理全部走 core/board-filter
 *   纯函数：分区（活动/归档）→ 排序 → 颜色过滤 → 文字搜索；展示做**懒加载**
 *   （首批 8 条，滚动触底逐步展开，见 nextWindow）；颜色筛选只作用于活动区；
 *   文字搜索同时作用于活动区与归档区（展开后可见）；
 * - lanes：任务泳道 —— 五列状态看板（布局参考 dsh-task-board），纸色即状态
 *   （core/task-lanes 派生），活动便签全量渲染（泳道列内自带滚动，不做懒加载
 *   窗口以免把后列切空）；颜色筛选行在泳道下隐藏（列本身已按色分列，语义冲突）；
 *   归档便签不进泳道（已离开工作流），底部以细提示行引导切列表视图管理。
 *
 * 视图/筛选/搜索变更时窗口重置回首批；视图选择、颜色筛选、搜索词存于
 * board-store（模块级），开关浮层不丢。
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { NoteId, NoteRecord } from "../../types.ts";
import type { TaskStatus } from "../core/task-lanes.ts";
import { boardStore } from "../core/board-store.ts";
import {
  partitionNotes,
  filterNotesByColors,
  searchNotes,
  initialWindow,
  nextWindow,
  type LazyWindow,
} from "../core/board-filter.ts";
import { t } from "../core/theme-tokens.ts";
import { NoteCard, CARD_CSS } from "../components/note-card.tsx";
import { NoteRow, ROW_CSS } from "../components/note-row.tsx";
import { TaskLanes, LANES_CSS } from "../components/task-lanes.tsx";
import { LANE_CARD_CSS } from "../components/task-lane-card.tsx";
import { ColorFilter, FILTER_CSS } from "../components/color-filter.tsx";
import {
  ArchivedSection,
  ARCHIVED_CSS,
} from "../components/archived-section.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import {
  Kanban,
  LayoutGrid,
  Plus,
  Rows3,
  Search,
  SearchX,
  X,
} from "lucide-react";

export interface BoardMainProps {
  readonly notes: readonly NoteRecord[];
  readonly busy: boolean;
  readonly onEdit: (note: NoteRecord) => void;
  readonly onTogglePin: (note: NoteRecord) => void;
  readonly onToggleArchive: (note: NoteRecord) => void;
  readonly onRemove: (note: NoteRecord) => void;
  readonly onCreate: () => void;
  /** 任务泳道：拖拽换列（目标状态→纸色由 board-view 落 notes.update）。 */
  readonly onMove: (noteId: NoteId, status: TaskStatus) => void;
}

/** board-main 覆盖的所有类选择器样式（统一注入一次）。 */
const BOARD_CSS = `${CARD_CSS}${ROW_CSS}${FILTER_CSS}${ARCHIVED_CSS}${LANE_CARD_CSS}${LANES_CSS}`;

export function BoardMain(props: BoardMainProps): JSX.Element {
  const view = useSyncExternalStore(
    boardStore.subscribe,
    () => boardStore.view,
  );
  const colors = useSyncExternalStore(
    boardStore.subscribe,
    () => boardStore.colors,
  );
  const query = useSyncExternalStore(
    boardStore.subscribe,
    () => boardStore.query,
  );

  const [win, setWin] = useState<LazyWindow>(initialWindow);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const { active, archived } = useMemo(
    () => partitionNotes(props.notes),
    [props.notes],
  );
  const activeMatched = useMemo(
    () => searchNotes(filterNotesByColors(active, colors), query),
    [active, colors, query],
  );
  const archivedMatched = useMemo(
    () => searchNotes(archived, query),
    [archived, query],
  );

  // 视图/筛选/搜索变化时，懒加载窗口回到首批。
  useEffect(() => {
    setWin(initialWindow());
    setArchivedOpen(false);
  }, [view, colors, query]);

  const activeVisible = useMemo(
    () => activeMatched.slice(0, win.active),
    [activeMatched, win.active],
  );
  const archivedVisible = useMemo(
    () => archivedMatched.slice(0, win.archived),
    [archivedMatched, win.archived],
  );

  const noNotes = props.notes.length === 0;
  const hasFilter = colors.length > 0 || query.trim() !== "";
  const noMatch =
    hasFilter && activeMatched.length === 0 && archivedMatched.length === 0;

  /** 滚动触底 → 展开下一批（活动区优先，归档区展开后才补）。 */
  function handleScroll(): void {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 60) return;
    setWin((w) =>
      nextWindow(
        w,
        { active: activeMatched.length, archived: archivedMatched.length },
        archivedOpen,
      ),
    );
  }

  const rowHandlers = (note: NoteRecord) => ({
    onEdit: () => props.onEdit(note),
    onTogglePin: () => props.onTogglePin(note),
    onToggleArchive: () => props.onToggleArchive(note),
    onRemove: () => props.onRemove(note),
  });

  return (
    <>
      <style>{BOARD_CSS}</style>

      <div style={toolbarStyle}>
        {!noNotes && (
          <div style={searchRowStyle}>
            <Search
              size={14}
              style={{ flex: "none", color: t.labelTertiary }}
            />
            <input
              value={query}
              placeholder="搜索标题或正文…"
              aria-label="搜索便签"
              onChange={(e) => boardStore.setQuery(e.target.value)}
              style={searchInput}
            />
            {query !== "" && (
              <button
                type="button"
                title="清除搜索"
                aria-label="清除搜索"
                style={clearBtn}
                onClick={() => boardStore.setQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {/* <span style={hintStyle}>
          {noNotes
            ? ''
            : noMatch
              ? `无匹配 · 共 ${props.notes.length} 条便签`
              : hasFilter
                ? `匹配 ${activeMatched.length + archivedMatched.length} 条`
                : '置顶优先 · 最近更新在前'}
        </span> */}
        <span style={{ flex: 1 }} />
        <div role="group" aria-label="视图切换" style={viewGroup}>
          <button
            type="button"
            title="纸卡墙"
            aria-label="纸卡墙"
            aria-pressed={view === "grid"}
            style={viewBtn(view === "grid")}
            onClick={() => boardStore.setView("grid")}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            title="任务泳道"
            aria-label="任务泳道"
            aria-pressed={view === "lanes"}
            style={viewBtn(view === "lanes")}
            onClick={() => boardStore.setView("lanes")}
          >
            <Kanban size={15} />
          </button>
          <button
            type="button"
            title="行式列表"
            aria-label="行式列表"
            aria-pressed={view === "list"}
            style={viewBtn(view === "list")}
            onClick={() => boardStore.setView("list")}
          >
            <Rows3 size={15} />
          </button>
        </div>
        <button
          type="button"
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
            onToggle={(c) => boardStore.toggleColor(c)}
            onClear={() => boardStore.clearColors()}
          />
        </div>
      )}

      <div ref={listRef} onScroll={handleScroll} style={listStyle}>
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
                    onClick={() => boardStore.setView("list")}
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

            <ArchivedSection
              count={archivedMatched.length}
              open={archivedOpen}
              onToggle={() => setArchivedOpen((v) => !v)}
              renderContent={() =>
                view === "grid" ? (
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
                )
              }
            />

            {noMatch && (
              <div style={noMatchStyle}>
                <span>试试：</span>
                {query.trim() !== "" && (
                  <button
                    type="button"
                    style={clearFilterBtn}
                    onClick={() => boardStore.setQuery("")}
                  >
                    清除搜索「{query.trim()}」
                  </button>
                )}
                {colors.length > 0 && (
                  <button
                    type="button"
                    style={clearFilterBtn}
                    onClick={() => boardStore.clearColors()}
                  >
                    清除颜色筛选
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* ---------- 样式 ---------- */

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px 4px",
};
const hintStyle: React.CSSProperties = {
  color: t.labelCaption,
  fontSize: 12,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
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
  padding: "8px 16px 0",
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
