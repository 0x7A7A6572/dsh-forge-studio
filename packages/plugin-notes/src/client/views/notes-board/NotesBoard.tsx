/**
 * 便签板页面 —— ui-layout `main` keyed slot 的一个主面板（key 见 core/notes-panel）：
 * 侧栏顶部入口选中它时才挂载，**挂载即可见**，不需要自己管可见性。
 *
 * 本文件只有编排与 JSX：状态、取数、保存流、键盘事件全在 useNotesBoard（同目录）。
 * 内容 = 列表页 BoardMain 常驻 + 编辑器弹窗（components/EditorPageDialog）+ 使用说明弹窗。
 * 设置**不在板内**：它已搬到 dsh 设置面板的「便签」分区（views/settings-section），
 * 所以这里既没有齿轮也没有设置弹窗 —— 设置入口不再受便签入口开关影响。
 *
 * 视觉契约：纸卡是「便签纸」语义（固定 pastel 底 + 深色文字，见 note-colors）；
 * 其余 UI 走宿主 --dsw-* 令牌（见 theme-tokens）。
 */

import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { BadgeInfo, ChevronLeft, RefreshCw, X } from 'lucide-react'
import type { NotesBoardFace } from './useNotesBoard.ts'
import { useNotesBoard } from './useNotesBoard.ts'
import { BoardMain } from './components/BoardMain.tsx'
import { EditorPageDialog } from '../../components/EditorPageDialog.tsx'
import { NotesHelpDialog } from '../../components/NotesHelpDialog.tsx'
import { t } from '../../core/theme-tokens.ts'
import styles from '../../styles/notes-board.module.css'

export interface NotesBoardProps {
  readonly face: NotesBoardFace
  /**
   * 本品挂在哪块地里：
   * - 'main'（缺省）：中间列主面板，挂载时广播、并监听 sibling 面板的反向广播
   *   （task-board / ssh / daily-log 仍在抢中间列，见 core/notes-panel 的互斥协议）；
   * - 'sidebar'：右侧栏 tab（见 views/notes-sidebar-body）。它不占中间列，所以两边都
   *   不参与 —— 广播白赶走兄弟面板，监听则会被兄弟面板关掉自己的 tab。
   */
  readonly surface?: 'main' | 'sidebar'
}

export function NotesBoard(props: NotesBoardProps): JSX.Element {
  const {
    notes,
    loading,
    busy,
    error,
    activeCount,
    helpOpen,
    editing,
    defaultTitle,
    workspaces,
    workspacesReady,
    taskTargets,
    closeBoard,
    refresh,
    dismissError,
    toggleHelp,
    closeHelp,
    openEditor,
    createNote,
    closeEditor,
    saveDraft,
    togglePin,
    toggleArchive,
    remove,
    move,
    execute,
    reset,
    createTask,
  } = useNotesBoard({ face: props.face, ...(props.surface === undefined ? {} : { surface: props.surface }) })

  return (
    <div style={frameStyle} role="region" aria-label="便签板">
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
            className={styles.backBtn}
            data-dsh-center-view-back=""
            title="返回会话"
            aria-label="返回会话"
            onClick={closeBoard}
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
                className={styles.spinner}
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
            className={styles.headerBtn}
            onClick={toggleHelp}
            disabled={busy}
            style={{ ...iconBtn, ...(busy ? iconBtnDisabled : {}) }}
          >
            <BadgeInfo size={15} />
          </button>
          <button
            type="button"
            title="刷新"
            className={styles.headerBtn}
            onClick={refresh}
            disabled={busy}
            style={{ ...iconBtn, ...(busy ? iconBtnDisabled : {}) }}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            title="关闭便签板"
            className={styles.headerBtn}
            onClick={closeBoard}
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
            onClick={dismissError}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div style={bodyWrap}>
        <BoardMain
          notes={notes}
          busy={busy}
          onEdit={openEditor}
          onTogglePin={togglePin}
          onToggleArchive={toggleArchive}
          onRemove={remove}
          onCreate={createNote}
          onMove={move}
          onExecute={execute}
          onReset={reset}
          onCreateTask={createTask}
        />
      </div>

      {editing && (
        <EditorPageDialog
          target={editing}
          defaultTitle={defaultTitle}
          workspaceOptions={workspaces}
          workspaceReady={workspacesReady}
          taskTargets={taskTargets}
          onCancel={closeEditor}
          onSave={saveDraft}
        />
      )}

      {helpOpen && <NotesHelpDialog onClose={closeHelp} />}
    </div>
  )
}

/* ---------- 样式（内联几何 + 主题令牌；hover/focus/animation 在 notes-board.module.css） ---------- */

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
