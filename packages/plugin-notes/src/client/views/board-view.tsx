/**
 * 便签板页面（中间列面板挂载点，与 dsh-task-board 同构）：占满中间列的
 * 面板框架，数据直连 host。本组件只当**数据控制器 + 渲染出口**：
 * - 数据流：开关订阅、拉取（事件驱动，无定时轮询）、错误条、busy 与保存流（saveDraft → run → refresh）；
 * - 弹窗层：编辑器/设置/使用说明是互斥浮层弹窗，开关一律读 notes-nav store，
 *   不再持有 draft/settingsOpen 本地 state（加弹窗只扩 notes-nav + 下方渲染处）；
 * - 内容：列表页 BoardMain 常驻，编辑器弹窗 = EditorPageDialog（独立文件），
 *   设置弹窗（默认标题）由 header 齿轮打开，直接读写注入的命名空间 scope；
 *   使用说明弹窗（只读 markdown）由 header 说明按钮打开。
 *
 * 视觉契约：纸卡是「便签纸」语义（固定 pastel 底 + 深色文字，见 note-colors）；
 * 其余 UI 走宿主 --dsw-* 令牌（见 theme-tokens）。面板开关由 panel-mount 经
 * `<html>` 上的 data 属性控制，本组件始终挂载（关闭时被 CSS 隐藏，会话子树
 * 保持状态），所以不再返回 null。
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  NoteColor,
  NoteId,
  NoteRecord,
  NoteScheduleInput,
  NotesConfig,
  NoteUpdateInput,
} from "../../types.ts";
import { scheduleSignature } from "../../schedule.ts";
import type { TaskStatus } from "../core/task-lanes.ts";
import { lanePatchForSave } from "../core/task-lanes.ts";
import { boardStore } from "../core/board-store.ts";
import { notesChangeBus, notesStatsStore } from "../core/notes-stats.ts";
import { notesNav } from "../core/notes-nav.ts";
import type { NotesRemote } from "../core/notes-remote.ts";
import { t } from "../core/theme-tokens.ts";
import type { NoteSaveOptions, NoteTaskDraft } from "../components/note-editor.tsx";
import { NotesSettingsDialog } from "../components/settings-dialog.tsx";
import { NotesHelpDialog } from "../components/notes-help-dialog.tsx";
import { BoardMain } from "./board-main.tsx";
import { EditorPageDialog } from "./editor-page-dialog.tsx";
import {
  BadgeInfo,
  RefreshCw,
  Settings,
  X,
  ChevronLeft,
} from "lucide-react";

/** 面板注入面：由 client 入口在挂载时提供。 */
export interface NotesBoardFace {
  readonly notes: NotesRemote;
  /** forge-studio-notes 命名空间 scope（默认标题/默认工作区读写，见 settings-dialog）。 */
  readonly scope: SettingsScope<NotesConfig>;
}

export interface NotesBoardProps {
  readonly face: NotesBoardFace;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** §8 提示：执行需宿主可新建会话（no-dispatch / dispatch-failed 共用）。 */
const EXECUTE_NEEDS_SESSION_HINT = '执行需要宿主能新建会话（会话控制器不可用或投递被拒）';

/** 未指定工作区提示（便签级 + 设置默认都为空）：任务必须跑在明确的工作区。 */
const EXECUTE_NEEDS_WORKSPACE_HINT =
  '任务便签未指定工作区：请在该便签编辑器里填写，或到设置里配置「默认工作区」';

/** 任务执行事务失败 reason → 用户提示。 */
function executeError(
  reason: 'missing' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed',
): string {
  switch (reason) {
    case 'missing':
      return '便签不存在，无法执行';
    case 'busy':
      return '任务正在执行中或不可执行';
    case 'missing-workspace':
      return EXECUTE_NEEDS_WORKSPACE_HINT;
    case 'no-dispatch':
    case 'dispatch-failed':
      return EXECUTE_NEEDS_SESSION_HINT;
  }
}

/** 头部按钮 hover/按压过渡、加载 spinner 与弹窗入场动效。 */
const FRAME_CSS = `
.fs-note-header-btn { transition: background 130ms ease, color 130ms ease, transform 90ms ease; }
.fs-note-header-btn:active:not(:disabled) { transform: scale(0.94); }
.fs-note-header-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.fs-note-back-btn { transition: background 130ms ease, color 130ms ease; }
.fs-note-back-btn:hover { display: flex; algin-items: center; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
@keyframes fs-note-spin { to { transform: rotate(360deg); } }
.fs-note-spinner { border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-label-tertiary); border-radius: 50%; animation: fs-note-spin 0.8s linear infinite; }
@keyframes fs-note-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fs-note-pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.fs-note-overlay { animation: fs-note-fade 160ms ease-out backwards; }
.fs-note-dialog { animation: fs-note-pop 200ms cubic-bezier(0.22, 1, 0.36, 1) backwards; }
@media (prefers-reduced-motion: reduce) {
  .fs-note-header-btn, .fs-note-back-btn, .fs-note-overlay, .fs-note-dialog { animation: none !important; transition: none !important; }
}
`;

export function NotesBoard(props: NotesBoardProps): JSX.Element {
  const open = useSyncExternalStore(
    boardStore.subscribe,
    () => boardStore.open,
  );
  // 弹窗层：编辑器（目标）与设置/说明开关都由导航 store 决定（跨开关浮层保留）。
  const editing = useSyncExternalStore(
    notesNav.subscribe,
    () => notesNav.editing,
  );
  const settingsOpen = useSyncExternalStore(
    notesNav.subscribe,
    () => notesNav.settingsOpen,
  );
  const helpOpen = useSyncExternalStore(
    notesNav.subscribe,
    () => notesNav.helpOpen,
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
  /** 工作区候选（最近会话用过的 cwd，设置/编辑器下拉用；拿不到即空数组）。 */
  const [workspaces, setWorkspaces] = useState<readonly string[]>([]);
  /**
   * 工作区候选是否已加载完成：编辑器「用默认（目录）」文案在就绪前**不写「未配置」**，
   * 否则候选一到就会被真目录替换，用户看到的就是「提示一闪而过」。
   */
  const [workspacesReady, setWorkspacesReady] = useState(false);

  const defaultTitle = snapshot.value?.defaultTitle ?? "新便签";
  /** 设置里的默认工作区（任务便签未单独指定时用它新建执行会话）。 */
  const defaultWorkspace = snapshot.value?.defaultWorkspace ?? "";
  /**
   * 生效默认工作区（只用于 UI 文案）：设置值 → 最近会话目录，与 host 侧
   * defaultWorkspace() 的兜底一致，这样「用默认（xxx）」显示的就是真正会用的目录。
   */
  const effectiveDefaultWorkspace =
    defaultWorkspace !== "" ? defaultWorkspace : (workspaces[0] ?? "");

  async function refresh(silent = false): Promise<void> {
    if (!silent) setLoading(true);
    const result = await props.face.notes.list();
    if (result.ok) {
      setNotes(result.value);
      // 侧栏「活动待办」徽标：板内操作/变更推送后即时同步（关板时由 notes-stats 事件订阅兜底）。
      notesStatsStore.sync(result.value);
      setError(undefined);
    } else if (!silent) {
      setError(errText(result.error));
    }
    if (!silent) setLoading(false);
  }

    // 事件驱动（替代原 5s/1.5s 轮询）：开板首刷；之后任何写（本板操作、
  // agent 工具、WebDAV 恢复等）由宿主 notes/watch 推送 → 静默刷新。无定时器。
  useEffect(() => {
    if (!open) return;
    void refresh();
    return notesChangeBus.subscribe(() => {
      void refresh(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 工作区候选：**挂载即拉**（不等开板）。编辑器里的「用默认（目录）」文案依赖它，
  // 等开板才拉的话，用户开板后马上点开编辑器就会先看到「未配置」再被真目录替换。
  // 只读端点，失败静默——没有候选就只是一个空下拉；拉完置 ready（文案才写「未配置」）。
  useEffect(() => {
    let alive = true;
    void props.face.notes
      .listWorkspaces()
      .then((result) => {
        if (alive && result.ok) setWorkspaces(result.value);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setWorkspacesReady(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc：按弹窗层级收 —— 使用说明 → 设置弹窗 → 编辑器弹窗 → 整个面板
  // （编辑器内的 Esc 由 NoteEditor 处理并 stopPropagation，不会走到这里）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (helpOpen) notesNav.setHelpOpen(false);
      else if (settingsOpen) notesNav.setSettingsOpen(false);
      else if (editing) notesNav.closeEditor();
      else boardStore.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, settingsOpen, editing, helpOpen]);

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

  /**
   * 静默写（自动保存用）：成功静默刷新；失败只落错误条，**不动全局 busy**——自动保存
   * 每隔几秒触发一次，动 busy 会让板内控件跟着一闪一闪。
   */
  async function quietRun(action: () => Promise<unknown>): Promise<boolean> {
    try {
      const result = await action();
      if (result && typeof result === "object" && "ok" in result) {
        const outcome = result as { ok: boolean; error?: { message?: string } };
        if (!outcome.ok) {
          setError(outcome.error?.message ?? "自动保存失败");
          return false;
        }
      }
      await refresh(true);
      return true;
    } catch (cause) {
      setError(errText(cause));
      return false;
    }
  }

  /**
   * 保存草稿（唯一落库口：编辑器按钮 / Ctrl+S / 自动保存都走这里）。
   * options.close（默认 true）= 保存成功后关弹窗；自动保存与 Ctrl+S 传 false（留在弹窗里
   * 继续改）；options.silent = 静默（不置 busy、不打断输入，见 quietRun）。
   */
  async function saveDraft(
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: NoteTaskDraft,
    options?: NoteSaveOptions,
  ): Promise<void> {
    const current = notesNav.editing;
    if (!current) return;
    const close = options?.close !== false;
    const save = (action: () => Promise<unknown>): Promise<boolean> =>
      options?.silent === true ? quietRun(action) : run(action);
    // 工作区一律 trim 后落库（空串 = 未指定，执行时回退设置默认值）。
    const workspace = taskPatch.workspace.trim();
    if (current.mode === "create") {
      // 新建：开关开 → 以 laneStatus 落任务身份；关 → 普通便签（原路径不变）。
      // 列头「＋新建任务」的初始状态已由 EditorPageDialog 合成进编辑器初值，此处
      // 开关是唯一真相（用户可在弹窗内改状态/取消任务）。
      // 定时日程：只有任务便签才带（普通便签无 lane，host 侧同样会忽略）。
      const schedule = taskPatch.on ? taskPatch.schedule : undefined;
      const ok = await save(() =>
        props.face.notes.create({
          title,
          text: body,
          color,
          ...(taskPatch.on ? { laneStatus: taskPatch.status } : {}),
          ...(workspace !== "" ? { workspace } : {}),
          ...(schedule !== undefined ? { schedule } : {}),
        }),
      );
      if (ok && close) notesNav.closeEditor();
    } else {
      // 编辑：仅当用户在对话框内实际改了任务状态才发 lane.status（含「普通便签转
      // 任务」）；状态未改不携带 lane——否则编辑器打开期间陈旧快照会把宿主已 settle
      // / 已执行的最新状态回滚；开关关且原本是任务 → clear（取消任务）；关且非任务
      // → 纯内容更新。running 任务的开关在编辑器里只读（状态不可能改），故不会对
      // running lane 发任何 patch。
      const laneForUpdate = lanePatchForSave(taskPatch.on, taskPatch.status, current.note.lane);
      // workspace 只在真的改了才发（空串 = 清除该字段，回退设置默认值）；未改不发，
      // 避免编辑器打开期间的无谓写入。
      const workspaceChanged = workspace !== (current.note.workspace ?? "");
      // 定时日程：编辑器草稿（任务态）→ 与便签上既有日程比「可写字段签名」。未改不发，
      // 免得编辑器打开期间宿主写回的 nextAt/lastResult 被陈旧快照覆盖；草稿缺失（关掉
      // 定时或取消任务）而便签上有日程 → 发 null 清除。
      const draftSchedule: NoteScheduleInput | undefined = taskPatch.on ? taskPatch.schedule : undefined;
      const schedulePatch: NoteScheduleInput | null | undefined =
        draftSchedule === undefined
          ? current.note.schedule !== undefined
            ? null
            : undefined
          : scheduleSignature(draftSchedule) !== scheduleSignature(current.note.schedule)
            ? draftSchedule
            : undefined;
      const patch: NoteUpdateInput = {
        title,
        text: body,
        color,
        ...(laneForUpdate !== undefined ? { lane: laneForUpdate } : {}),
        ...(workspaceChanged ? { workspace } : {}),
        ...(schedulePatch !== undefined ? { schedule: schedulePatch } : {}),
      };
      const ok = await save(() => props.face.notes.update(current.note.id, patch));
      if (ok && close) notesNav.closeEditor();
    }
  }

  /** 泳道卡执行/重跑：busy 守卫 → taskExecute → 失败提示 → 刷新。 */
  async function onExecute(note: NoteRecord): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // 执行 = host 按工作区新建会话后投递（便签板所在会话不参与执行）。
      const result = await props.face.notes.taskExecute(note.id);
      if (!result.ok) {
        setError(errText(result.error));
        return;
      }
      if (!result.value.ok) {
        setError(executeError(result.value.reason));
      }
      await refresh(true);
    } catch (cause) {
      setError(errText(cause));
    } finally {
      setBusy(false);
    }
  }

  /** 泳道卡重置为待办（手动接管）：busy 守卫 → taskReset → 刷新。 */
  async function onReset(note: NoteRecord): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await props.face.notes.taskReset(note.id);
      if (!result.ok) {
        setError(errText(result.error));
        return;
      }
      if (!result.value.ok) {
        setError('重置失败：便签不存在或非任务');
      }
      await refresh(true);
    } catch (cause) {
      setError(errText(cause));
    } finally {
      setBusy(false);
    }
  }

  /** 泳道列头「＋」：打开新建编辑器，预置 lane 状态为当前列。 */
  function onCreateTask(status: TaskStatus): void {
    notesNav.openEditor({ mode: 'create', laneStatus: status });
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
            title="使用说明"
            aria-label="使用说明"
            aria-pressed={helpOpen}
            className="fs-note-header-btn"
            onClick={() => notesNav.setHelpOpen(!helpOpen)}
            disabled={busy}
            style={{ ...iconBtn, ...(busy ? iconBtnDisabled : {}) }}
          >
            <BadgeInfo size={15} />
          </button>
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
          // 泳道拖拽换列：状态写回 lane（颜色与状态已解耦，纸色不再表状态）。
          onMove={(id: NoteId, status: TaskStatus) =>
            void run(() => props.face.notes.update(id, { lane: { status } }))
          }
          // 泳道执行/重置/列头新建任务（Task 7）。
          onExecute={(note) => void onExecute(note)}
          onReset={(note) => void onReset(note)}
          onCreateTask={onCreateTask}
        />
      </div>

      {editing && (
        <EditorPageDialog
          target={editing}
          defaultTitle={defaultTitle}
          defaultWorkspace={effectiveDefaultWorkspace}
          workspaceOptions={workspaces}
          workspaceReady={workspacesReady}
          onCancel={() => notesNav.closeEditor()}
          onSave={saveDraft}
        />
      )}

      {settingsOpen && (
        <NotesSettingsDialog
          scope={scope}
          snapshot={snapshot}
          notes={props.face.notes}
          workspaceOptions={workspaces}
          onError={(message) => setError(message)}
          // 设置保存（默认标题等）后即时刷新板数据（WIP 事件化：等推送会滞后）。
          onDataChanged={() => void refresh(true)}
          onClose={() => notesNav.setSettingsOpen(false)}
        />
      )}

      {helpOpen && (
        <NotesHelpDialog onClose={() => notesNav.setHelpOpen(false)} />
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