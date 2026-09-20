/**
 * 便签板主体视图（board-view 内容区）：工具栏（提示/显示模式切换/新建）+
 * 搜索行 + 颜色筛选行 + 活动便签 + 底部归档折叠区。
 *
 * 三种显示模式（board-store 记忆，模块级）：
 * - grid：纸卡墙（默认） / list：行式列表 —— 数据整理全部走 core/board-filter
 *   纯函数：分区（活动/归档）→ 排序 → 颜色过滤 → 文字搜索；展示做**懒加载**
 *   （首批 16 条，底部哨兵进入视口即续批，见 nextWindow）；颜色筛选只作用于活动区；
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
import { EmptyState } from "../components/empty-state.tsx";
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
  /** 任务泳道：执行/重跑（非 running 卡主入口）。 */
  readonly onExecute: (note: NoteRecord) => void;
  /** 任务泳道：重置为待办（running 卡主入口，手动接管）。 */
  readonly onReset: (note: NoteRecord) => void;
  /** 任务泳道：列头「＋」新建任务（初始 lane.status = 列状态）。 */
  readonly onCreateTask: (status: TaskStatus) => void;
}

/** 动效基础层：入场 keyframes、工具栏按压、搜索聚焦与 reduced-motion 降级。
 *  fs-note-in 被纸卡/行/泳道卡/归档展开/空状态共同引用（同注入一次 <style>）。 */
const MOTION_CSS = `
@keyframes fs-note-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 任务徽章 running 呼吸点（task-badge.tsx 引用，纸卡/行/泳道共用一次注入）。 */
@keyframes fs-task-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
.fs-task-live-dot { animation: fs-task-pulse 1.3s ease-in-out infinite; }
.fs-note-tool { transition: background 130ms ease, color 130ms ease, transform 90ms ease; }
.fs-note-tool:active:not(:disabled) { transform: scale(0.95); }
.fs-note-search-row { transition: border-color 160ms ease, box-shadow 160ms ease; }
.fs-note-search-row:focus-within { border-color: var(--dsw-static-deepseek-450); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-static-deepseek-450) 18%, transparent); }
.fs-note-search-clear { animation: fs-note-in 160ms ease-out backwards; }
.fs-note-empty { animation: fs-note-in 240ms ease-out backwards; }
@media (prefers-reduced-motion: reduce) {
  .fs-note-card, .fs-note-row, .fs-lane-card,
  .fs-note-search-clear, .fs-note-empty, .fs-note-filter-chip, .fs-note-tool,
  .fs-note-search-row, .fs-note-lane, .fs-task-live-dot { animation: none !important; transition: none !important; }
  .fs-lane-card.fs-lane-running::after { animation: none !important; opacity: 0 !important; }
}
`;

/** board-main 覆盖的所有类选择器样式（统一注入一次）。 */
const BOARD_CSS = `${MOTION_CSS}${CARD_CSS}${ROW_CSS}${FILTER_CSS}${LANE_CARD_CSS}${LANES_CSS}`;

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
  // 底部哨兵：进入视口下沿附近即继续展开懒加载窗口（见下方 effect）。
  const [sentinelInView, setSentinelInView] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // 归档 dock 展开后把列表滚到底所需（列表 div 本身是滚动容器）。
  const listScrollRef = useRef<HTMLDivElement | null>(null);

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

  /** 尚未懒加载显示的条目数（活动区 + 展开中的归档区）。 */
  const remaining =
    activeMatched.length - activeVisible.length +
    (archivedOpen ? archivedMatched.length - archivedVisible.length : 0);

  const noNotes = props.notes.length === 0;
  const hasFilter = colors.length > 0 || query.trim() !== "";
  const noMatch =
    hasFilter && activeMatched.length === 0 && archivedMatched.length === 0;

  // 底部哨兵观察：宿主外层或列表 div 任意一方滚动到哨兵附近都触发（不依赖
  // 具体哪个容器在滚 —— 旧 onScroll 在首批内容不足一屏时永不触发）。
  useEffect(() => {
    const el = sentinelRef.current;
    // jsdom/无 IO 环境静默降级（不自动续批，仍有「加载更多」按钮兜底）。
    if (!el || view === "lanes" || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setSentinelInView(entry.isIntersecting);
      },
      { root: null, rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [view]);

  // 哨兵可见期间逐批展开，直到填满可视区或全部加载完。
  useEffect(() => {
    if (!sentinelInView || view === "lanes") return;
    if (
      win.active >= activeMatched.length &&
      (!archivedOpen || win.archived >= archivedMatched.length)
    ) {
      return;
    }
    setWin((w) =>
      nextWindow(
        w,
        { active: activeMatched.length, archived: archivedMatched.length },
        archivedOpen,
      ),
    );
  }, [sentinelInView, view, win, archivedOpen, activeMatched.length, archivedMatched.length]);

  /** 「加载更多」手动兜底：点一次展开一批。 */
  function loadMore(): void {
    setWin((w) =>
      nextWindow(
        w,
        { active: activeMatched.length, archived: archivedMatched.length },
        archivedOpen,
      ),
    );
  }

  /** 展开/收起归档：展开后把列表滚到底，让归档内容直接出现在 dock 条上方。 */
  function toggleArchived(): void {
    setArchivedOpen((open) => {
      if (!open) {
        window.requestAnimationFrame(() => {
          const el = listScrollRef.current;
          if (!el) return;
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        });
      }
      return !open;
    });
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
          <div className="fs-note-search-row" style={searchRowStyle}>
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
                className="fs-note-search-clear"
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
            className="fs-note-tool"
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
            className="fs-note-tool"
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
            className="fs-note-tool"
            style={viewBtn(view === "list")}
            onClick={() => boardStore.setView("list")}
          >
            <Rows3 size={15} />
          </button>
        </div>
        <button
          type="button"
          className="fs-note-tool"
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

/* ---------- 样式 ---------- */

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px 4px",
};
const _hintStyle: React.CSSProperties = {
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
