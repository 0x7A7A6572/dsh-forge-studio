/**
 * 便签行（列表视图）：一行一条便签 —— 整行以纸色（note.color）为背景 +
 * 标题/单行摘要 + 更新时间 + 悬停浮出的操作（编辑/置顶/归档或恢复/删除）。
 * 行本身可点击进入编辑；与 NoteCard 共用同样的操作集合语义。
 */

import { useState } from "react";
import type { NoteRecord } from "../../types.ts";
import {
  NOTE_INK,
  NOTE_INK_MUTED,
  noteColorMeta,
} from "../core/note-colors.ts";
import { mdSnippet } from "../core/markdown-text.ts";
import { fmtRelative } from "../core/time-text.ts";
import { copyNoteMention } from "../core/note-clipboard.ts";
import { TaskBadge } from "./task-badge.tsx";
import {
  Archive,
  ArchiveRestore,
  Check,
  AtSign,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";

/** 行 hover/焦点态与操作浮现。 */
export const ROW_CSS = `
.fs-note-row { transition: box-shadow 120ms ease; animation: fs-note-in 240ms ease-out backwards; }
.fs-note-row:hover { box-shadow: inset 0 0 0 999px rgba(0, 0, 0, 0.06); }
.fs-note-row:focus-visible { outline: 2px solid var(--dsw-static-deepseek-450); outline-offset: -1px; }
.fs-note-actions { opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.fs-note-row:hover .fs-note-actions, .fs-note-row:focus-within .fs-note-actions { opacity: 1; pointer-events: auto; }
.fs-note-row .fs-note-actions button { color: rgba(46, 42, 34, 0.55); transition: background 110ms ease, color 110ms ease; }
.fs-note-row .fs-note-actions button:hover:not(:disabled) { background: rgba(0, 0, 0, 0.1); color: #2e2a22; }
.fs-note-row .fs-note-actions button[data-danger]:hover:not(:disabled) { background: rgba(197, 48, 48, 0.18); color: #b3261e; }
`;

export interface NoteRowProps {
  readonly note: NoteRecord;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onTogglePin: () => void;
  readonly onToggleArchive: () => void;
  readonly onRemove: () => void;
}

export function NoteRow(props: NoteRowProps): JSX.Element {
  const { note } = props;
  const [copied, setCopied] = useState(false);
  const flashCopied = (): void => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const meta = noteColorMeta(note.color);
  const snippet = note.text ? mdSnippet(note.text, 160) : "";
  return (
    <li>
      <div
        className="fs-note-row"
        role="button"
        tabIndex={0}
        aria-label={
          note.archived
            ? `已归档：${note.title || "无标题"}`
            : note.pinned
              ? `置顶：${note.title || "无标题"}`
              : note.title || "无标题"
        }
        onClick={props.onEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onEdit();
          }
        }}
        style={{ ...rowStyle, background: meta.paper }}
      >
        <span style={bodyStyle}>
          <span style={titleRow}>
            <span style={titleStyle} title={note.title || "（无标题）"}>
              {note.title || (
                <span style={{ color: NOTE_INK_MUTED }}>（无标题）</span>
              )}
            </span>
            {note.lane && <TaskBadge lane={note.lane} />}
            {note.pinned && !note.archived && (
              <Pin
                size={12}
                style={{ flex: "none", color: meta.ring }}
                aria-label="已置顶"
              />
            )}
          </span>
          {snippet && <span style={snippetStyle}>{snippet}</span>}
          <time
            style={timeStyle}
            title={new Date(note.updatedAt).toLocaleString()}
          >
            {fmtRelative(note.updatedAt)}
          </time>
        </span>

        <span className="fs-note-actions" style={actionsStyle}>
          <button
            type="button"
            title={copied ? "已复制引用" : "引用到会话"}
            aria-label={copied ? "已复制引用" : "引用到会话"}
            disabled={props.busy}
            onClick={(e) => {
              e.stopPropagation();
              void copyNoteMention(note.id, note.title).then((ok) => {
                if (ok) flashCopied();
              });
            }}
            style={actionBtn}
          >
            {copied ? <Check size={13} /> : <AtSign size={13} />}
          </button>
          <button
            type="button"
            title="编辑"
            aria-label="编辑"
            disabled={props.busy}
            onClick={(e) => {
              e.stopPropagation();
              props.onEdit();
            }}
            style={actionBtn}
          >
            <Pencil size={13} />
          </button>
          {!note.archived && (
            <button
              type="button"
              title={note.pinned ? "取消置顶" : "置顶"}
              aria-label={note.pinned ? "取消置顶" : "置顶"}
              disabled={props.busy}
              onClick={(e) => {
                e.stopPropagation();
                props.onTogglePin();
              }}
              style={{
                ...actionBtn,
                ...(note.pinned ? { color: meta.ring } : {}),
              }}
            >
              <Pin size={13} />
            </button>
          )}
          <button
            type="button"
            title={note.archived ? "恢复（取消归档）" : "归档"}
            aria-label={note.archived ? "恢复" : "归档"}
            disabled={props.busy}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleArchive();
            }}
            style={actionBtn}
          >
            {note.archived ? (
              <ArchiveRestore size={13} />
            ) : (
              <Archive size={13} />
            )}
          </button>
          <button
            type="button"
            title="删除"
            aria-label="删除"
            data-danger
            disabled={props.busy}
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove();
            }}
            style={actionBtn}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
    </li>
  );
}

/* ---------- 样式 ---------- */

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 10px",
  borderRadius: 10,
  cursor: "pointer",
  minHeight: 44,
  boxSizing: "border-box",
};
const bodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 1,
};
const titleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  minWidth: 0,
};
const titleStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: 13,
  fontWeight: 600,
  color: NOTE_INK,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const snippetStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: 12,
  color: NOTE_INK_MUTED,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const timeStyle: React.CSSProperties = {
  flex: "none",
  fontSize: 11.5,
  color: NOTE_INK_MUTED,
  whiteSpace: "nowrap",
};
const actionsStyle: React.CSSProperties = {
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
};
const actionBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  padding: 0,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  cursor: "pointer",
};
