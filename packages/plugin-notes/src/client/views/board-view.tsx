/**
 * 便签板页面（中间列面板挂载点，与 dsh-task-board 同构）：占满中间列的
 * 面板框架，数据直连 host。本组件只当**数据控制器 + 渲染出口**：
 * - 数据流：开关订阅、拉取/轮询、错误条、busy 与保存流（saveDraft → run → refresh）；
 * - 弹窗层：编辑器/设置是两个互斥浮层弹窗，开关一律读 notes-nav store，
 *   不再持有 draft/settingsOpen 本地 state（加弹窗只扩 notes-nav + 下方渲染处）；
 * - 内容：列表页 BoardMain 常驻，编辑器弹窗 = EditorPageDialog（独立文件），
 *   设置弹窗（默认标题）由 header 齿轮打开，直接读写注入的命名空间 scope。
 *
 * 视觉契约：纸卡是「便签纸」语义（固定 pastel 底 + 深色文字，见 note-colors）；
 * 其余 UI 走宿主 --dsw-* 令牌（见 theme-tokens）。面板开关由 panel-mount 经
 * `<html>` 上的 data 属性控制，本组件始终挂载（关闭时被 CSS 隐藏，会话子树
 * 保持状态），所以不再返回 null。
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { NoteColor, NoteId, NoteRecord, NotesConfig } from "../../types.ts";
import { colorForStatus } from "../core/task-lanes.ts";
import type { TaskStatus } from "../core/task-lanes.ts";
import { boardStore } from "../core/board-store.ts";
import { notesNav } from "../core/notes-nav.ts";
import type { NotesRemote } from "../core/notes-remote.ts";
import { t } from "../core/theme-tokens.ts";
import { NotesSettingsDialog } from "../components/settings-dialog.tsx";
import { BoardMain } from "./board-main.tsx";
import { EditorPageDialog } from "./editor-page-dialog.tsx";
import { RefreshCw, Settings, X, ChevronLeft } from "lucide-react";

/** 面板注入面：由 client 入口在挂载时提供。 */
export interface NotesBoardFace {
  readonly notes: NotesRemote;
  /** forge-studio-notes 命名空间 scope（默认标题读写，见 settings-dialog）。 */
  readonly scope: SettingsScope<NotesConfig>;
}

export interface NotesBoardProps {
  readonly face: NotesBoardFace;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 头部按钮 hover 与加载 spinner。 */
const FRAME_CSS = `
.fs-note-header-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.fs-note-back-btn:hover { display: flex; algin-items: center; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
@keyframes fs-note-spin { to { transform: rotate(360deg); } }
.fs-note-spinner { border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-label-tertiary); border-radius: 50%; animation: fs-note-spin 0.8s linear infinite; }
`;

export function NotesBoard(props: NotesBoardProps): JSX.Element {
  const open = useSyncExternalStore(
    boardStore.subscribe,
    () => boardStore.open,
  );
  // 弹窗层：编辑器（目标）与设置开关都由导航 store 决定（跨开关浮层保留）。
  const editing = useSyncExternalStore(
    notesNav.subscribe,
    () => notesNav.editing,
  );
  const settingsOpen = useSyncExternalStore(
    notesNav.subscribe,
    () => notesNav.settingsOpen,
  );
  // 订阅命名空间 scope：默认标题在设置弹窗保存后实时生效（新建便签/弹窗展示）。
  const scope = props.face.scope;
  const snapshot = useSyncExternalStore(
    (cb) => scope.subscribe(cb),
    () => scope.getSnapshot(),
  );
  const [notes, setNotes] = useState<readonly NoteRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const defaultTitle = snapshot.value?.defaultTitle ?? "新便签";

  async function refresh(silent = false): Promise<void> {
    if (!silent) setLoading(true);
    const result = await props.face.notes.list();
    if (result.ok) {
      setNotes(result.value);
      setError(undefined);
    } else if (!silent) {
      setError(errText(result.error));
    }
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = setInterval(() => void refresh(true), 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc：按弹窗层级收 —— 设置弹窗 → 编辑器弹窗 → 整个面板
  // （编辑器内的 Esc 由 NoteEditor 处理并 stopPropagation，不会走到这里）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (settingsOpen) notesNav.setSettingsOpen(false);
      else if (editing) notesNav.closeEditor();
      else boardStore.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, settingsOpen, editing]);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await action();
      if (result && typeof result === "object" && "ok" in result) {
        const outcome = result as { ok: boolean; error?: { message?: string } };
        if (!outcome.ok) {
          setError(outcome.error?.message ?? "操作失败");
          return false;
        }
      }
      await refresh(true);
      return true;
    } catch (cause) {
      setError(errText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(
    title: string,
    body: string,
    color: NoteColor,
  ): Promise<void> {
    const current = notesNav.editing;
    if (!current) return;
    if (current.mode === "create") {
      const ok = await run(() =>
        props.face.notes.create({ title, text: body, color }),
      );
      if (ok) notesNav.closeEditor();
    } else {
      const ok = await run(() =>
        props.face.notes.update(current.note.id, {
          title,
          text: body,
          color,
        }),
      );
      if (ok) notesNav.closeEditor();
    }
  }

  const activeCount = notes.filter((n) => !n.archived).length;

  return (
    <div style={frameStyle} role="region" aria-label="便签板">
      <style>{FRAME_CSS}</style>
      <header style={headerStyle}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <button
            type="button"
            className="fs-note-back-btn"
            data-dsh-center-view-back=""
            title="返回会话"
            aria-label="返回会话"
            onClick={() => boardStore.hide()}
            style={backBtn}
          >
            <ChevronLeft size={16} />
            <span>返回</span>
          </button>
          <span style={panelTitle}>便签板</span>
          <span style={countPill}>{activeCount}</span>
        </span>
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {loading && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: t.labelCaption,
                fontSize: 12,
              }}
            >
              <span
                className="fs-note-spinner"
                style={{ width: 12, height: 12 }}
              />{" "}
              加载中…
            </span>
          )}
          <button
            type="button"
            title="便签板设置"
            aria-label="便签板设置"
            aria-pressed={settingsOpen}
            className="fs-note-header-btn"
            onClick={() => notesNav.setSettingsOpen(!settingsOpen)}
            disabled={busy}
            style={{ ...iconBtn, ...(busy ? iconBtnDisabled : {}) }}
          >
            <Settings size={15} />
          </button>
          <button
            type="button"
            title="刷新"
            className="fs-note-header-btn"
            onClick={() => void refresh()}
            disabled={busy}
            style={{ ...iconBtn, ...(busy ? iconBtnDisabled : {}) }}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            title="关闭便签板"
            className="fs-note-header-btn"
            onClick={() => boardStore.hide()}
            style={iconBtn}
          >
            <X size={15} />
          </button>
        </span>
      </header>

      {error && (
        <div style={errorStrip}>
          <span style={{ flex: 1 }}>⚠ {error}</span>
          <button
            type="button"
            aria-label="关闭错误提示"
            style={{ ...iconBtn, color: "inherit", width: 22, height: 22 }}
            onClick={() => setError(undefined)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div style={bodyWrap}>
        <BoardMain
          notes={notes}
          busy={busy}
          onEdit={(note) => notesNav.openEditor({ mode: "edit", note })}
          onTogglePin={(note) =>
            void run(() => props.face.notes.setPinned(note.id, !note.pinned))
          }
          onToggleArchive={(note) =>
            void run(() =>
              props.face.notes.update(note.id, { archived: !note.archived }),
            )
          }
          onRemove={(note) => void run(() => props.face.notes.delete(note.id))}
          onCreate={() => notesNav.openEditor({ mode: "create" })}
          // 泳道拖拽换列：状态 → 纸色写入（颜色是唯一真相，一次更新到处同步）。
          onMove={(id: NoteId, status: TaskStatus) =>
            void run(() => props.face.notes.update(id, { color: colorForStatus(status) }))
          }
        />
      </div>

      {editing && (
        <EditorPageDialog
          target={editing}
          defaultTitle={defaultTitle}
          onCancel={() => notesNav.closeEditor()}
          onSave={saveDraft}
        />
      )}

      {settingsOpen && (
        <NotesSettingsDialog
          scope={scope}
          snapshot={snapshot}
          onError={(message) => setError(message)}
          onClose={() => notesNav.setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------- 样式 ---------- */

const frameStyle: React.CSSProperties = {
  position: "relative",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
  overflow: "hidden",
  background: t.surface,
  color: t.labelPrimary,
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  padding: "14px 16px 10px",
  borderBottom: `1px solid ${t.borderL1}`,
  flex: "none",
};
const backBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 28,
  padding: "0 10px",
  border: `1px solid ${t.borderL2}`,
  borderRadius: 8,
  background: "transparent",
  color: t.labelPrimary,
  fontSize: 12,
  cursor: "pointer",
  flex: "none",
};
const panelTitle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 15,
  color: t.labelPrimary,
};
const countPill: React.CSSProperties = {
  minWidth: 22,
  height: 20,
  padding: "0 7px",
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  fontSize: 12,
  color: t.labelSecondary,
  background: t.hoverBg,
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  border: "none",
  borderRadius: 8,
  background: "transparent",
  color: t.labelSecondary,
  cursor: "pointer",
};
const iconBtnDisabled: React.CSSProperties = {
  opacity: 0.45,
  cursor: "default",
};
const errorStrip: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  margin: "10px 16px 0",
  padding: "7px 10px",
  borderRadius: 8,
  fontSize: 13,
  color: t.danger,
  background: t.hoverDangerBg,
  flex: "none",
};
const bodyWrap: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};
