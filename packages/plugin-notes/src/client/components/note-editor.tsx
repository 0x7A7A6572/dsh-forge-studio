/**
 * 便签编辑器（tiptap + Markdown）：标题输入 + 富文本正文 + 格式操作栏。
 * - 正文经 tiptap-markdown 序列化保存为真实 Markdown（不再丢格式）；
 * - 操作栏：粗体/斜体/删除线/标题H1-H3/无序·有序列表/任务清单(todolist)/引用/
 *   行内代码/代码块（+ 语言选择）/分隔线/链接（弹层设置）/表格（插入·行列操作）/撤销/重做；
 * - 代码块语言高亮、链接与表格能力来自共享扩展层 core/note-richtext.ts
 *   （note-preview 只读渲染复用同一套，保证编辑与展示一致）；
 * - 粘贴图片：剪贴板图片文件 → data URL 内联插入正文（![图](data:...)）；
 * - 保存：编辑既有便签时**停顿约 1 秒自动保存**（不关弹窗、不打断输入），
 *   Ctrl/Cmd+S 立即保存（同样不关弹窗）；Ctrl/Cmd+Enter 与「保存」按钮仍是
 *   「保存并关闭」；新建态没有库记录，故只走显式保存（Ctrl+S 等同「保存」）；
 * - 快捷键：Esc 关闭弹层或取消，Ctrl/Cmd+K 插入链接，Ctrl/Cmd+S 保存不关闭。
 * 父组件用 key 控制实例重建（新建/每条便签各一个编辑器），初值即草稿内容。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { MarkdownStorage } from "tiptap-markdown";
import { DEFAULT_NOTE_COLOR, SCHEDULE_MODES } from "../../types.ts";
import type { NoteColor, NoteLane, NoteScheduleInput, ScheduleMode, TaskStatus } from "../../types.ts";
import {
  SCHEDULE_MAX_FAILURES,
  SCHEDULE_RUN_TIMEOUT_MS,
  fromLocalDateTimeInput,
  makeSchedule,
  previewNextAt,
  scheduleBlockTextFor,
  scheduleLabel,
  toLocalDateTimeInput,
} from "../../schedule.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import {
  NOTE_COLOR_PALETTE,
  NOTE_INK,
  NOTE_INK_MUTED,
  noteColorMeta,
} from "../core/note-colors.ts";
import { TASK_LANES, isRunOpen, laneLabel } from "../core/task-lanes.ts";
import { createAutoSaver, type AutoSaver } from "../core/auto-save.ts";
import { fmtDateTime } from "../core/time-text.ts";
import { fileToDataUrl, pickImageFiles } from "../core/paste-image.ts";
import { t } from "../core/theme-tokens.ts";
import { folderNameOf, workspaceSelectOptions } from "../core/workspace-path.ts";
import { buildNoteRichTextExtensions } from "../core/note-richtext.ts";
import { NoteImageResizable } from "./note-image-view.tsx";
import {
  CODE_LANGUAGES,
  codeLanguageLabel,
} from "../core/code-languages.ts";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  Check,
  ChevronDown,
  Clock,
  ChevronUp,
  Code,
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

// 图片扩展定义挪至共享层 core/note-richtext.ts，此处仅再导出保持兼容。
export { NoteImage } from "../core/note-richtext.ts";

/** 只读 markdown 渲染（正文观感）：run.summary 是 agent 写回的 markdown 总结，
 * 不能用纯文本展示。复用正文同款排版栈（EDITOR_CSS 已由编辑器根部注入一次，
 * 这里只补只读覆盖），观感与便签正文一致 —— 链接可点开、代码高亮/表格同源。 */
function RunSummaryMarkdown(props: { readonly markdown: string }): JSX.Element {
  const editor = useEditor({
    extensions: buildNoteRichTextExtensions({ readonly: true }),
    content: props.markdown,
    editable: false,
  });
  return (
    <div className="fs-note-editor fs-note-preview fs-note-run-summary">
      <style>{RUN_SUMMARY_PREVIEW_CSS}</style>
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * 保存选项（编辑器 → 宿主保存口 → 数据控制器）。
 * - `close`（默认 true）：保存成功后是否关闭弹窗；自动保存 / Ctrl+S 传 false；
 * - `silent`：静默保存（自动保存用）——不置 saving 态、不置全局 busy，避免把
 *   正在输入的标题框 disabled 掉（输入框一 disabled 焦点就没了）。
 */
export interface NoteSaveOptions {
  readonly close?: boolean;
  readonly silent?: boolean;
}

/**
 * 任务草稿 patch（编辑器 → 保存链路 → board-view 落库）：
 * `on` = 是否任务便签；`status` = 泳道状态；`workspace` = 执行工作区（空串 = 用默认）；
 * `schedule` = 定时日程草稿（undefined = 不定时；已停用的日程仍带 enabled:false 对象）。
 */
export interface NoteTaskDraft {
  readonly on: boolean;
  readonly status: TaskStatus;
  readonly workspace: string;
  readonly schedule?: NoteScheduleInput;
}

/** 定时周期下拉的中文标签（与 SCHEDULE_MODES 一一对应）。 */
const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  once: "一次性",
  interval: "间隔",
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
};

/** 星期几短标签（0=周日；与 Date#getDay 对齐）。 */
const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"] as const;

export interface NoteEditorProps {
  readonly initialTitle: string;
  readonly initialBody: string;
  /** 便签纸颜色（缺省默认黄）。 */
  readonly initialColor?: NoteColor;
  /**
   * 既有便签的任务泳道身份（编辑态带出，新建态恒 undefined）。存在即任务，
   * 用于预选「设为任务」开关/状态，并渲染只读「任务与结果」区（含 run 执行结果）。
   * running（isRunOpen）时开关与状态选择只读（改状态请先在泳道重置）。
   */
  readonly initialLane?: NoteLane;
  /**
   * 新建态任务预填状态（列头「＋新建任务」，仅创建态使用）：非空即预填「设为任务」
   * 开关开 + 该状态；不渲染只读结果区（新建无既有 run）。编辑态恒 undefined。
   */
  readonly initialLaneStatus?: TaskStatus;
  /**
   * 既有便签的执行工作区（编辑态带出，新建态 undefined）：任务是「在某个工作区
   * 里跑的事」，执行时以该目录新建会话；留空即回退设置里的默认工作区。
   */
  readonly initialWorkspace?: string;
  /**
   * 既有便签的定时日程（编辑态带出，新建态 undefined = 不定时）。日程只有任务便签
   * 才有意义（host 侧同样约束）：任务开关关闭时编辑器不显示该行，保存时按「清除」落库。
   */
  readonly initialSchedule?: NoteScheduleInput;
  /**
   * 纸色切换回调：弹窗整卡背景随所选纸色实时变化（新建/编辑的初值分别由
   * initialColor / 宿主传入，切换发生在底部取色器）。
   */
  readonly onColorChange?: (color: NoteColor) => void;
  /** 标题留空时使用的默认标题（来自设置）。 */
  readonly defaultTitle: string;
  /** 设置里的默认工作区（占位提示：留空即用它新建执行会话）。 */
  readonly defaultWorkspace?: string;
  /** 工作区候选（最近会话用过的 cwd；下拉只选不手填，选项标签只给文件夹名）。 */
  readonly workspaceOptions?: readonly string[];
  /**
   * 工作区候选是否已加载完成。未就绪时「用默认」文案不写「（未配置）」——那个中间态
   * 会在候选到达后立刻变成真目录，用户看到的就是「提示一闪而过」（见 board-view）。
   */
  readonly workspaceReady?: boolean;
  /** 编辑既有便签时开启：停顿后自动保存（不关弹窗）。新建态恒 false。 */
  readonly autoSave?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: NoteTaskDraft,
    options?: NoteSaveOptions,
  ) => void | Promise<void>;
}

/** 自动保存延迟：最后一次改动后静置多久落盘（太短会边打字边写库）。 */
const AUTO_SAVE_DELAY_MS = 1200;
/** 自动保存撞上在途保存时的重试间隔。 */
const AUTO_SAVE_RETRY_MS = 500;

/**
 * 编辑器内容区排版（tiptap 生成的 HTML 在此样式化；令牌取色，明暗自适应）。
 * 导出供只读渲染（note-preview.tsx）复用同一套便签正文排版。
 */
export const EDITOR_CSS = `
.fs-note-editor { position: relative; font-size: 14px; line-height: 1.7; color: var(--dsw-alias-label-primary); padding: 10px; }
.fs-note-editor .ProseMirror { outline: none; min-height: 200px; caret-color: var(--dsw-static-deepseek-400); }
.fs-note-editor .ProseMirror p { margin: 0 0 4px; }
.fs-note-editor .ProseMirror h1, .fs-note-editor .ProseMirror h2, .fs-note-editor .ProseMirror h3 { margin: 10px 0 4px; line-height: 1.35; }
.fs-note-editor .ProseMirror h1 { font-size: 19px; } .fs-note-editor .ProseMirror h2 { font-size: 17px; }
.fs-note-editor .ProseMirror h3 { font-size: 15px; }
.fs-note-editor .ProseMirror ul, .fs-note-editor .ProseMirror ol { margin: 2px 0; padding-left: 22px; }
.fs-note-editor .ProseMirror li { margin: 1px 0; }
.fs-note-editor .ProseMirror blockquote { margin: 4px 0; padding: 0 0 0 10px; border-left: 3px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); }
.fs-note-editor .ProseMirror code { background: var(--dsw-alias-markdown-inline-code); border-radius: 4px; padding: 1px 4px; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.fs-note-editor .ProseMirror pre { background: var(--dsw-alias-markdown-code-block); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }
.fs-note-editor .ProseMirror pre code { background: none; padding: 0; font-size: 13px; }
.fs-note-editor .ProseMirror hr { border: none; border-top: 1px solid var(--dsw-alias-border-l2); margin: 10px 0; }
.fs-note-editor .ProseMirror a { color: var(--dsw-static-deepseek-450); cursor: pointer; text-decoration: none; }
.fs-note-editor .ProseMirror a:hover { text-decoration: underline; text-underline-offset: 2px; }
/* 只读展示态（.fs-note-preview）链接默认带下划线，可直接点开（openOnClick）。 */
.fs-note-editor.fs-note-preview .ProseMirror a { text-decoration: underline; text-underline-offset: 2px; }
.fs-note-editor .ProseMirror img { max-width: 66.67%; height: auto; border-radius: 6px; }
.fs-note-editor .ProseMirror img[width] { max-width: 100%; }
.fs-note-image-wrap { position: relative; display: inline; }
.fs-note-image-wrap img { vertical-align: bottom; }
.fs-note-image-handle { position: absolute; right: 2px; bottom: 2px; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: none; border-radius: 6px; background: var(--dsw-static-deepseek-450); color: #fff; cursor: nwse-resize; z-index: 5; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28); }
.fs-note-editor .ProseMirror p:has(> img) {  }
.fs-note-editor .ProseMirror img.ProseMirror-selectednode { outline: 2px solid var(--dsw-static-deepseek-450); }
/* 选中态（主题表面＝只读预览）：宿主 bubble-highlight 是给气泡内标记用的极淡高亮，
   作选区几乎看不见，改用品牌蓝半透明（保留文字原色，明暗主题都清晰）。
   纸面编辑态另有反相规则，见下方 .fs-note-editor--paper 段（顺序在后、层叠胜出）。 */
.fs-note-editor .ProseMirror ::selection { background: color-mix(in srgb, var(--dsw-static-deepseek-450) 32%, transparent); }
.fs-note-editor input:focus { border-color: var(--dsw-static-deepseek-450); }
.fs-note-tool:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.fs-note-editor .fs-note-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.fs-note-editor .fs-note-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.fs-note-color { transition: transform 100ms ease; }
.fs-note-color:hover:not(:disabled) { transform: scale(1.15); }
.fs-note-color:focus-visible { outline: 2px solid var(--dsw-static-deepseek-450); outline-offset: 1px; }

/* ---------- 表格 ---------- */
.fs-note-editor .ProseMirror table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 6px 0; overflow: hidden; }
.fs-note-editor .ProseMirror th, .fs-note-editor .ProseMirror td { border: 1px solid var(--dsw-alias-border-l3); padding: 5px 8px; vertical-align: top; min-width: 40px; position: relative; word-break: break-word; }
.fs-note-editor .ProseMirror th { font-weight: 600; text-align: left; background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); }
.fs-note-editor .ProseMirror .selectedCell::after { content: ""; position: absolute; inset: 0; background: color-mix(in srgb, var(--dsw-static-deepseek-400) 18%, transparent); pointer-events: none; }

/* ---------- 待办清单（todolist） ----------
   官方 taskItem 结构：ul[data-type=taskList] > li[data-checked] > label>input + div>p。
   label/input 由扩展渲染（勾选框不参与文本编辑），这里只做排版与勾选态观感；
   勾选状态来自 checked 属性（data-checked），与 Markdown 的 - [ ]/- [x] 一一对应。 */
.fs-note-editor .ProseMirror ul[data-type="taskList"] { list-style: none; margin: 2px 0; padding-left: 2px; }
.fs-note-editor .ProseMirror ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 6px; margin: 1px 0; }
.fs-note-editor .ProseMirror ul[data-type="taskList"] li > label { flex: none; display: inline-flex; align-items: center; margin-top: 0.32em; user-select: none; }
.fs-note-editor .ProseMirror ul[data-type="taskList"] li > label input { width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: var(--dsw-static-deepseek-450); }
.fs-note-editor .ProseMirror ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.fs-note-editor .ProseMirror ul[data-type="taskList"] li > div > p { margin: 0; }
.fs-note-editor .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }
.fs-note-editor .ProseMirror ul[data-type="taskList"] ul[data-type="taskList"] { margin: 1px 0 1px 4px; padding-left: 0; }
/* 只读展示态（note-preview / 任务结果区 / 使用说明）：勾选框仅展示状态，不可交互。 */
.fs-note-editor.fs-note-preview .ProseMirror ul[data-type="taskList"] li > label input { cursor: default; }

/* ---------- 代码语法高亮 token（映射宿主 --shiki-token-*，带字面量回退） ---------- */
.fs-note-editor .ProseMirror .hljs-comment, .fs-note-editor .ProseMirror .hljs-quote { color: var(--shiki-token-comment, #868e96); font-style: italic; }
.fs-note-editor .ProseMirror .hljs-keyword, .fs-note-editor .ProseMirror .hljs-selector-tag, .fs-note-editor .ProseMirror .hljs-name, .fs-note-editor .ProseMirror .hljs-doctag, .fs-note-editor .ProseMirror .hljs-meta { color: var(--shiki-token-keyword, #d6336c); }
.fs-note-editor .ProseMirror .hljs-string, .fs-note-editor .ProseMirror .hljs-regexp, .fs-note-editor .ProseMirror .hljs-addition, .fs-note-editor .ProseMirror .hljs-attr, .fs-note-editor .ProseMirror .hljs-attribute, .fs-note-editor .ProseMirror .hljs-selector-attr, .fs-note-editor .ProseMirror .hljs-template-variable { color: var(--shiki-token-string, #2f9e44); }
.fs-note-editor .ProseMirror .hljs-number, .fs-note-editor .ProseMirror .hljs-literal, .fs-note-editor .ProseMirror .hljs-constant, .fs-note-editor .ProseMirror .hljs-symbol, .fs-note-editor .ProseMirror .hljs-bullet { color: var(--shiki-token-constant, #1c7ed6); }
.fs-note-editor .ProseMirror .hljs-title, .fs-note-editor .ProseMirror .hljs-function, .fs-note-editor .ProseMirror .hljs-type, .fs-note-editor .ProseMirror .hljs-section, .fs-note-editor .ProseMirror .hljs-class { color: var(--shiki-token-function, #6741d9); }
.fs-note-editor .ProseMirror .hljs-params, .fs-note-editor .ProseMirror .hljs-operator { color: var(--shiki-token-parameter, #e8590c); }
.fs-note-editor .ProseMirror .hljs-link { color: var(--shiki-token-link, #1971c2); text-decoration: underline; }

/* ---------- 工具栏弹层（链接 / 表格）与代码语言下拉 ---------- */
.fs-note-editor .fs-note-pop { position: absolute; top: 100%; left: 0; z-index: 40; margin-top: 6px; min-width: 236px; max-width: 320px; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 10px; background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2)); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; box-shadow: var(--dsw-shadow-lv3); }
.fs-note-editor .fs-note-pop-title { margin: 0; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.fs-note-editor .fs-note-field { box-sizing: border-box; width: 100%; padding: 6px 8px; font-size: 13px; color: var(--dsw-alias-label-primary); background: transparent; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; }
.fs-note-editor .fs-note-field:focus { border-color: var(--dsw-static-deepseek-450); }
.fs-note-editor .fs-note-field[disabled] { opacity: 0.6; }
.fs-note-editor .fs-note-pop-row { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.fs-note-editor .fs-note-pop-item { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 6px 8px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12.5px; cursor: pointer; text-align: left; }
.fs-note-editor .fs-note-pop-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.fs-note-editor .fs-note-pop-item:disabled { opacity: 0.4; cursor: default; }
.fs-note-editor .fs-note-pop-grid { display: inline-flex; flex-direction: column; gap: 3px; align-self: flex-start; }
.fs-note-editor .fs-note-pop-grid-row { display: flex; gap: 3px; }
.fs-note-editor .fs-note-pop-grid-cell { width: 17px; height: 17px; padding: 0; border: 1px solid var(--dsw-alias-border-l3); border-radius: 3px; background: transparent; cursor: pointer; box-sizing: border-box; }
.fs-note-editor .fs-note-pop-grid-cell.on { background: color-mix(in srgb, var(--dsw-static-deepseek-450) 55%, transparent); border-color: var(--dsw-static-deepseek-450); }
.fs-note-editor .fs-note-pop-grid-cell:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-static-deepseek-450) 30%, transparent); }
.fs-note-lang-select { max-width: 150px; height: 28px; padding: 0 6px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); background: transparent; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; outline: none; cursor: pointer; }
.fs-note-lang-select:focus { border-color: var(--dsw-static-deepseek-450); }
.fs-note-lang-select:disabled { opacity: 0.35; cursor: default; }

/* ---------- 弹窗纸态覆盖（.fs-note-editor--paper） ----------
   编辑器所在弹窗整卡是浅 pastel 便签纸（纸色实时随取色器变化），正文与控件统一
   转 NOTE_INK 墨迹族（明暗自适应无效，纸底恒浅）；只读预览（.fs-note-preview）
   不带该修饰类，仍走宿主令牌自适应。弹层（链接/表格）是悬浮控件，保持主题表面。 */
.fs-note-editor--paper { color: #2E2A22; }
.fs-note-editor--paper .ProseMirror { color: #2E2A22; caret-color: var(--dsw-static-deepseek-400); }
.fs-note-editor--paper .ProseMirror blockquote { border-left-color: rgba(46, 42, 34, 0.32); color: rgba(46, 42, 34, 0.6); }
.fs-note-editor--paper .ProseMirror code { background: rgba(46, 42, 34, 0.1); color: #2E2A22; }
.fs-note-editor--paper .ProseMirror pre { background: rgba(46, 42, 34, 0.07); border-color: rgba(46, 42, 34, 0.14); color: #2E2A22; }
.fs-note-editor--paper .ProseMirror pre code { background: none; color: #2E2A22; }
.fs-note-editor--paper .ProseMirror hr { border-top-color: rgba(46, 42, 34, 0.22); }
.fs-note-editor--paper .ProseMirror a { color: #1458a0; }
.fs-note-editor--paper .ProseMirror a:hover { color: #0d3f75; }
.fs-note-editor--paper .ProseMirror th, .fs-note-editor--paper .ProseMirror td { border-color: rgba(46, 42, 34, 0.26); }
.fs-note-editor--paper .ProseMirror th { background: rgba(46, 42, 34, 0.06); }
.fs-note-editor--paper input::placeholder { color: rgba(46, 42, 34, 0.45); }
.fs-note-editor--paper input:focus { border-color: rgba(46, 42, 34, 0.5); }
/* 纸面待办清单：勾选框随墨迹（不用品牌蓝），勾选后墨字弱化（删除线走通用规则）。 */
.fs-note-editor--paper .ProseMirror ul[data-type="taskList"] li > label input { accent-color: #2E2A22; }
.fs-note-editor--paper .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div { color: rgba(46, 42, 34, 0.5); }
/* 便签标题（header 直写）：无边框输入，聚焦仅淡墨染底，保持「写在纸上」观感。 */
.fs-note-editor--paper .fs-note-title { border-radius: 7px; }
.fs-note-editor--paper .fs-note-title:hover { background: rgba(46, 42, 34, 0.045); }
.fs-note-editor--paper .fs-note-title:focus { background: rgba(46, 42, 34, 0.08); outline: none; }
.fs-note-editor--paper .fs-note-tool { color: rgba(46, 42, 34, 0.75); }
.fs-note-editor--paper .fs-note-tool:hover:not(:disabled) { background: rgba(46, 42, 34, 0.09); color: #2E2A22; }
.fs-note-editor--paper .fs-note-color:focus-visible { outline: 2px solid rgba(46, 42, 34, 0.55); }
.fs-note-editor--paper .fs-note-btn-primary:hover:not(:disabled) { background: #100e08; }
.fs-note-editor--paper .fs-note-lang-select { color: rgba(46, 42, 34, 0.85); border: none; background: rgba(46, 42, 34, 0.06); }
/* 选中态（纸面编辑）：纸底恒浅 + 墨字，若沿用主题高亮就只剩「灰底黑字」，选区与正文
   几乎分不出来。这里改为反相选中（墨底 + 纸白字）：六种纸色、标题/正文/代码块/结果区
   一律高对比。注意两条选择器都要写——.ProseMirror 那条与上方主题规则同为 (0,2,1)，
   靠「顺序在后」取胜；泛化那条管标题输入框与只读结果区（不受主题规则覆盖）。 */
.fs-note-editor--paper .ProseMirror ::selection,
.fs-note-editor--paper ::selection {
  background: rgba(46, 42, 34, 0.85);
  color: #FFFDF4;
}
.fs-note-run-toggle { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: none; border-radius: 7px; background: transparent; color: rgba(46, 42, 34, 0.72); font-size: 12.5px; cursor: pointer; }
.fs-note-run-toggle:hover { background: rgba(46, 42, 34, 0.09); color: #2E2A22; }
`;

/**
 * 弹窗纸态墨迹常量：编辑器所在弹窗整卡是固定浅 pastel 纸底（纸色由
 * editor-page-dialog 按当前颜色提供），明暗主题无关 —— 文字/边框一律用
 * NOTE_INK 墨迹族（与纸卡/行同款深字对比），不再取宿主 --dsw-* 令牌。
 */
const PAPER_DEEP_TINT = "rgba(46, 42, 34, 0.06)";
const PAPER_SOFT_FILL = "rgba(46, 42, 34, 0.1)";

type FormatState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  h1: boolean;
  h2: boolean;
  h3: boolean;
  bullet: boolean;
  ordered: boolean;
  /** 光标在待办清单（todolist）项内。 */
  taskList: boolean;
  quote: boolean;
  code: boolean;
  codeBlock: boolean;
  /** 光标所在代码块的语言标记（'' = 无语言）。 */
  codeLang: string;
  /** 光标在表格内。 */
  inTable: boolean;
  /** 选区（或光标处）是否命中链接。 */
  linkActive: boolean;
  /** 当前链接 href（命中链接时）。 */
  linkHref: string;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * 图片粘贴守卫。
 *
 * 背景：dsh web 的 modlens 插件在 document 捕获层注册了全局 paste 监听
 * （paste-to-path：对视觉模型接管图片粘贴，把图片上传成路径插入聊天框），
 * 事件在到达本编辑器（target 阶段）之前就被它 preventDefault +
 * stopImmediatePropagation 掐掉，tiptap 侧任何 handlePaste 都收不到。
 *
 * 对策：在同一事件的更早阶段 —— window 捕获层 —— 注册本守卫。它只接管
 * 「粘贴目标是本便签编辑器」的图片文件（转 data URL 内联插入正文），其余
 * 情况（聊天框等）一律放行，不影响 modlens 在其它输入框的行为。
 */
const registerPasteGuard = (() => {
  let installed = false;
  return (): void => {
    if (installed) return;
    installed = true;
    window.addEventListener(
      "paste",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        // 只处理本便签编辑器内的粘贴（.fs-note-editor 子树）。
        const editorEl = target.closest(".fs-note-editor");
        if (!editorEl) return;
        const pm = editorEl.querySelector(".ProseMirror");
        if (!pm) return;
        const editor = liveEditors.get(pm);
        if (!editor) return;
        const files = pickImageFiles(event.clipboardData);
        if (files.length === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void (async () => {
          for (const file of files) {
            const src = await fileToDataUrl(file);
            editor.chain().focus().setImage({ src, alt: "" }).run();
          }
        })();
      },
      true,
    );
  };
})();

/** 编辑器 DOM（.ProseMirror）→ Editor 实例，供捕获层守卫反查。 */
const liveEditors = new WeakMap<Element, Editor>();

function formatOf(editor: Editor | null): FormatState {
  if (!editor) return EMPTY_FORMAT;
  const h = (level: 1 | 2 | 3) => editor.isActive("heading", { level });
  const linkAttrs = editor.getAttributes("link");
  const codeAttrs = editor.getAttributes("codeBlock");
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    h1: h(1),
    h2: h(2),
    h3: h(3),
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    quote: editor.isActive("blockquote"),
    code: editor.isActive("code"),
    codeBlock: editor.isActive("codeBlock"),
    codeLang:
      typeof codeAttrs.language === "string" && codeAttrs.language !== ""
        ? codeAttrs.language
        : "",
    inTable: editor.isActive("table"),
    linkActive: editor.isActive("link"),
    linkHref: typeof linkAttrs.href === "string" ? linkAttrs.href : "",
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

const EMPTY_FORMAT: FormatState = {
  bold: false,
  italic: false,
  strike: false,
  h1: false,
  h2: false,
  h3: false,
  bullet: false,
  ordered: false,
  taskList: false,
  quote: false,
  code: false,
  codeBlock: false,
  codeLang: "",
  inTable: false,
  linkActive: false,
  linkHref: "",
  canUndo: false,
  canRedo: false,
};

/** 取编辑器当前 Markdown 正文；编辑器未就绪时回退初值。 */
function editorMarkdown(editor: Editor | null, fallback: string): string {
  if (!editor) return fallback.trim();
  const storage = editor.storage?.markdown as MarkdownStorage | undefined;
  return (storage?.getMarkdown() ?? editor.getText()).trim();
}

export function NoteEditor(props: NoteEditorProps): JSX.Element {
  const [title, setTitle] = useState(props.initialTitle);
  const [color, setColor] = useState<NoteColor>(
    props.initialColor ?? DEFAULT_NOTE_COLOR,
  );
  /** 当前纸色元信息（取色器高亮 / 强调色跟随纸色）。 */
  const colorMeta = noteColorMeta(color);
  /** 「设为任务」开关：既有任务（initialLane）或列头新建预填（initialLaneStatus）即开。 */
  const [taskOn, setTaskOn] = useState(
    props.initialLane !== undefined || props.initialLaneStatus !== undefined,
  );
  /** 任务状态选择：编辑态预选当前状态，新建态预填列状态，否则默认待办。 */
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(
    props.initialLane?.status ?? props.initialLaneStatus ?? "todo",
  );
  /**
   * 任务执行工作区：编辑态带出便签值，新建态留空。留空 = 不落字段，执行时回退
   * 运行时默认工作区（设置值 → 最近会话目录 → 宿主进程目录）。
   */
  const [workspace, setWorkspace] = useState(props.initialWorkspace ?? "");
  /**
   * 定时日程草稿（编辑态带出便签既有 schedule；新建/未定时 undefined）。nextAt 由 host
   * 保存时重算并写回，这里的值只用于编辑与预览（previewNextAt）。
   */
  const [schedule, setSchedule] = useState<NoteScheduleInput | undefined>(props.initialSchedule);
  /**
   * 开启「定时」前的行内确认草稿：点开关不直接落地，先让用户看清后果
   * （到点宿主会自动新建会话替你执行 = 无人值守跑 agent）。取消即清空，不动库。
   */
  const [scheduleConfirm, setScheduleConfirm] = useState<NoteScheduleInput | undefined>(undefined);
  /**
   * 间隔模式的数量单位（分钟/小时）：只影响展示与输入换算，落库统一为分钟（everyMin）。
   * 初值按既有间隔推断（60 的整数倍且 >= 60 视作小时）。
   */
  const [intervalUnit, setIntervalUnit] = useState<"min" | "hour">(() => {
    const minutes = props.initialSchedule?.everyMin ?? 30;
    return minutes % 60 === 0 && minutes >= 60 ? "hour" : "min";
  });
  /** 间隔输入框里显示的数量（按当前单位换算）。 */
  const intervalAmount =
    schedule?.everyMin === undefined
      ? 30
      : intervalUnit === "hour"
        ? schedule.everyMin / 60
        : schedule.everyMin;
  /** 定时行里的「下次触发」预览（已停用 → undefined）。 */
  const scheduleNextPreview = schedule !== undefined ? previewNextAt(schedule) : undefined;
  /**
   * 工作区只从「最近会话用过的目录」里挑（不提供手填新路径）。但便签上已存的
   * 工作区可能不在候选里（旧的显式值、或设置默认目录本就不在会话列表里），
   * 这种值也要列出来，否则一进编辑器就会被静默改掉。
   */
  const workspaceOptions = useMemo(
    () => workspaceSelectOptions(props.workspaceOptions ?? [], workspace),
    [props.workspaceOptions, workspace],
  );
  /**
   * 「用默认」项文案：候选还没拉回来时**不写「（未配置）」**——那是「还没数据」，不是
   * 「没配置」。写了它就会在候选到达的一瞬间被真目录替换，看起来正是「提示一闪而过」。
   */
  const defaultWorkspaceOptionLabel = props.defaultWorkspace
    ? `用默认（${folderNameOf(props.defaultWorkspace)}）`
    : props.workspaceReady === false
      ? "用默认工作区"
      : "用默认工作区（未配置）";
  const workspaceSelectTitle =
    workspace !== ""
      ? `工作区：${workspace}`
      : props.defaultWorkspace
        ? `默认工作区：${props.defaultWorkspace}`
        : props.workspaceReady === false
          ? "默认工作区：自动选择"
          : "未指定工作区";
  /** 编辑 running 任务（isRunOpen）：开关与状态只读（改状态请先在泳道重置）。 */
  const runningReadOnly =
    props.initialLane !== undefined && isRunOpen(props.initialLane);
  const [saving, setSaving] = useState(false);
  /** 任务执行结果是否展开（默认收起，避免长摘要把编辑器撑高）。 */
  const [runExpanded, setRunExpanded] = useState(false);

  /** 当前打开的工具栏弹层：link（链接）/ table（表格）。 */
  const [popup, setPopup] = useState<"link" | "table" | null>(null);
  /** 链接弹层草稿（textLocked=选区非空，文字由选中内容决定）。 */
  const [linkDraft, setLinkDraft] = useState<{
    text: string;
    url: string;
    textLocked: boolean;
  }>({ text: "", url: "", textLocked: false });
  /** 表格插入网格当前选择（列 × 行，各至少 1）。 */
  const [gridSize, setGridSize] = useState({ cols: 3, rows: 2 });

  const editor = useEditor({
    extensions: buildNoteRichTextExtensions({ imageNode: NoteImageResizable }),
    content: props.initialBody,
  });
  const fmt =
    useEditorState({ editor, selector: (s) => formatOf(s.editor) }) ??
    EMPTY_FORMAT;

  // 新建（正文为空）时把光标放进正文；编辑态聚焦标题更常用。
  useEffect(() => {
    if (editor && !props.initialBody.trim()) editor.commands.focus("end");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // 把编辑器 DOM 注册进捕获层守卫的查询表（卸载时清理）。
  useEffect(() => {
    if (!editor?.view?.dom) return;
    const dom = editor.view.dom as HTMLElement;
    if (!dom.classList.contains("ProseMirror")) return;
    liveEditors.set(dom, editor);
    registerPasteGuard();
    return () => {
      liveEditors.delete(dom);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  /** 显式保存（按钮 / Ctrl/Cmd+Enter）：默认保存并关闭弹窗。 */
  async function save(options?: NoteSaveOptions): Promise<void> {
    const body = editorMarkdown(editor, props.initialBody);
    const trimmed = title.trim();
    if (!trimmed && !body) {
      props.onCancel();
      return;
    }
    setSaving(true);
    try {
      await props.onSave(
        trimmed || props.defaultTitle,
        body,
        color,
        {
          on: taskOn,
          status: taskStatus,
          workspace,
          ...(schedule !== undefined ? { schedule } : {}),
        },
        options,
      );
    } finally {
      setSaving(false);
    }
  }

  /* ---------- 自动保存 / Ctrl+S（编辑既有便签，落盘但不关弹窗） ---------- */

  /** 自动保存指示灯（只在真落盘时变化，打字过程不刷状态）。 */
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  /** 最近一次落盘时刻（只做 title 悬停提示）。 */
  const lastSavedAt = useRef<number | null>(null);
  /** 自动保存调度器（防抖/在途补跑/取消，见 core/auto-save.ts）。 */
  const autoSaver = useRef<AutoSaver | null>(null);
  /** 在途标记：Ctrl+S 与调度器撞上时不并发（撞上就跳过，等在途那次落盘）。 */
  const autoSaving = useRef(false);
  /** 上次落盘的草稿签名：没变就不重复写库/广播。 */
  const savedSignature = useRef<string | null>(null);
  /**
   * 最新草稿镜像（标题/纸色/任务开关/状态/工作区）：自动保存回调异步执行，闭包里
   * 的 state 是排定时那一刻的旧值，故用 ref 取「保存时」的真值。
   */
  const draftRef = useRef({ title, color, taskOn, taskStatus, workspace, schedule });
  useEffect(() => {
    draftRef.current = { title, color, taskOn, taskStatus, workspace, schedule };
  });

  /**
   * 落盘一次：不关弹窗、不置 saving（标题框一 disabled 就丢焦点）。
   * - 空标题默认跳过（用户可能正在删标题，别把中间态写成默认标题）；
   *   显式 Ctrl+S（force）则补默认标题并同步到输入框；
   * - 草稿与上次落盘一致 → 不打库，只给「已保存」反馈。
   */
  async function autoSaveNow(force = false): Promise<void> {
    if (autoSaving.current) return;
    const draft = draftRef.current;
    let nextTitle = draft.title.trim();
    if (nextTitle === "") {
      if (!force) return;
      nextTitle = props.defaultTitle;
      setTitle(nextTitle);
    }
    const body = editorMarkdown(editor, props.initialBody);
    const signature = JSON.stringify([
      nextTitle,
      body,
      draft.color,
      draft.taskOn,
      draft.taskStatus,
      draft.workspace,
      draft.schedule ?? null,
    ]);
    if (signature === savedSignature.current) {
      setAutoSaveState("saved");
      return;
    }
    autoSaving.current = true;
    setAutoSaveState("saving");
    try {
      await props.onSave(
        nextTitle,
        body,
        draft.color,
        {
          on: draft.taskOn,
          status: draft.taskStatus,
          workspace: draft.workspace,
          ...(draft.schedule !== undefined ? { schedule: draft.schedule } : {}),
        },
        { close: false, silent: true },
      );
      savedSignature.current = signature;
      lastSavedAt.current = Date.now();
      setAutoSaveState("saved");
    } catch {
      setAutoSaveState("error");
    } finally {
      autoSaving.current = false;
    }
  }

  /** 有改动：标记一次自动保存（重置倒计时），并把「已保存」指示灯打回待保存。 */
  function markDirty(): void {
    if (props.autoSave !== true) return;
    setAutoSaveState((state) => (state === "saved" || state === "error" ? "idle" : state));
    autoSaver.current?.touch();
  }

  // 自动保存调度器：只在编辑既有便签（autoSave）时装配，卸载即 dispose。
  // save 走 ref 取当次渲染的 autoSaveNow（否则会闭包到首帧那个 editor 还是 null 的版本）。
  const autoSaveNowRef = useRef<(force?: boolean) => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    autoSaveNowRef.current = autoSaveNow;
  });
  useEffect(() => {
    if (props.autoSave !== true) return;
    const saver = createAutoSaver({
      delayMs: AUTO_SAVE_DELAY_MS,
      retryMs: AUTO_SAVE_RETRY_MS,
      save: () => autoSaveNowRef.current(),
    });
    autoSaver.current = saver;
    return () => {
      saver.dispose();
      autoSaver.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoSave]);

  // 正文改动 → 自动保存（tiptap 只在文档真变化时发 update，焦点/选区不算）。
  useEffect(() => {
    if (!editor || props.autoSave !== true) return;
    const onUpdate = (): void => markDirty();
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, props.autoSave]);

  /** 自动保存指示灯文案（新建态没有库记录，不显示）。 */
  const autoSaveHintText =
    props.autoSave !== true
      ? ""
      : autoSaveState === "saving"
        ? "保存中…"
        : autoSaveState === "error"
          ? "⚠ 自动保存失败"
          : autoSaveState === "saved"
            ? "已自动保存"
            : "自动保存";

  function run(fn: (e: Editor) => void): void {
    if (editor) fn(editor);
  }

  function closePopup(): void {
    setPopup(null);
  }

  /** 点弹层之外的任意处即关闭（捕获阶段；触发按钮带 data-fs-tool-pop 豁免）。 */
  useEffect(() => {
    if (!popup) return;
    const onPointerDown = (event: PointerEvent): void => {
      const el = event.target;
      if (!(el instanceof Element)) return;
      if (el.closest(".fs-note-pop, [data-fs-tool-pop]")) return;
      closePopup();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup]);

  /* ---------- 链接 ---------- */

  /** 打开链接弹层：预填当前链接地址与选中文字。 */
  function openLinkPopup(): void {
    if (!editor) return;
    const href = fmt.linkHref;
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? "" : editor.state.doc.textBetween(from, to, " ");
    setLinkDraft({
      text: selected,
      url: href || "",
      textLocked: !empty && selected !== "",
    });
    setPopup((p) => (p === "link" ? null : "link"));
  }

  /** 规范化地址：无 scheme 时补 https://（mailto:/file: 等带 scheme 的地址保留原样）。 */
  function normalizeUrl(raw: string): string {
    const value = raw.trim();
    if (!value) return "";
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
    return `https://${value}`;
  }

  /** 应用链接草稿。 */
  function applyLink(): void {
    if (!editor) return;
    const url = normalizeUrl(linkDraft.url);
    const text = linkDraft.text.trim();
    const { empty } = editor.state.selection;
    if (!url) {
      // 地址为空 → 视为移除链接（文字保留）
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      closePopup();
      return;
    }
    if (!empty) {
      // 已有选中文字：原地包成链接 / 更新其地址
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    } else if (text) {
      // 空光标 + 给了文字：插入「文字 + 链接」
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text,
          marks: [{ type: "link", attrs: { href: url } }],
        })
        .run();
    } else if (fmt.linkActive) {
      // 光标在既有链接内：整链改地址
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    closePopup();
  }

  /** 移除选区/光标处的链接。 */
  function unlinkAtSelection(): void {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    closePopup();
  }

  /** 链接弹层输入框：Enter 应用 / Esc 只关弹层（不再触发整卡取消）。 */
  const linkFieldKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      closePopup();
    }
  };

  /* ---------- 表格 ---------- */

  function toggleTablePopup(): void {
    setPopup((p) => (p === "table" ? null : "table"));
  }

  /** 插入 cols 列 × dataRows 数据行的表格（含表头行）。 */
  function insertTableGrid(cols: number, dataRows: number): void {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows: dataRows + 1, cols, withHeaderRow: true })
      .run();
    setPopup(null);
  }

  function tableOp(
    op:
      | "addRowBefore"
      | "addRowAfter"
      | "deleteRow"
      | "addColumnBefore"
      | "addColumnAfter"
      | "deleteColumn"
      | "deleteTable",
  ): void {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (op === "addRowBefore") chain.addRowBefore().run();
    else if (op === "addRowAfter") chain.addRowAfter().run();
    else if (op === "deleteRow") chain.deleteRow().run();
    else if (op === "addColumnBefore") chain.addColumnBefore().run();
    else if (op === "addColumnAfter") chain.addColumnAfter().run();
    else if (op === "deleteColumn") chain.deleteColumn().run();
    else {
      chain.deleteTable().run();
      setPopup(null);
    }
  }

  /* ---------- 代码语言 ---------- */

  /** 当前代码块语言是否在候选列表内（未知语言也允许保留展示）。 */
  const codeLangKnown = CODE_LANGUAGES.some((o) => o.value === fmt.codeLang);
  const selectLang = fmt.codeLang && codeLangKnown ? fmt.codeLang : "";
  const unknownLang = fmt.codeLang && !codeLangKnown ? fmt.codeLang : null;

  /** 给光标所在代码块设语言；空值 = 移除语言（无高亮）。 */
  function setCodeLanguage(lang: string): void {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .updateAttributes("codeBlock", { language: lang || null })
      .run();
  }

  return (
    <div
      className="fs-note-editor fs-note-editor--paper"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          void save();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          openLinkPopup();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          // Ctrl/Cmd+S：编辑既有便签 → 立即保存且**不关弹窗**（与自动保存同一路径）；
          // 新建态没有库记录，等同「保存」按钮（创建并关闭）。
          e.preventDefault();
          if (props.autoSave === true) {
            // 先取消排着的自动保存（避免刚落盘又被定时器跑一次），再立即保存。
            autoSaver.current?.cancel();
            void autoSaveNow(true);
          } else {
            void save();
          }
        } else if (e.key === "Escape") {
          if (popup) {
            // 弹层开启时：Esc 先关弹层，再按一次才取消编辑
            e.preventDefault();
            e.stopPropagation();
            closePopup();
          } else {
            e.preventDefault();
            e.stopPropagation();
            props.onCancel();
          }
        }
      }}
    >
      <style>{EDITOR_CSS}</style>

      {/* 头部行：便签标题直接放在 header（可编辑），省去单独的「新建便签」标题行 */}
      <div style={headRowStyle}>
        <input
          className="fs-note-title"
          autoFocus={!props.initialBody.trim()}
          placeholder={props.initialTitle.trim() ? undefined : "标题（留空使用默认标题）"}
          value={title}
          disabled={saving}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty();
          }}
          aria-label="便签标题"
          style={headTitleStyle}
        />
        <button
          type="button"
          title="关闭编辑器"
          aria-label="关闭编辑器"
          onClick={props.onCancel}
          style={headCloseBtn}
        >
          <X size={15} />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <ToolButton
          title="加粗 (Ctrl+B)"
          active={fmt.bold}
          disabled={saving}
          onClick={() => run((e) => e.chain().focus().toggleBold().run())}
        >
          <Bold size={16} />
        </ToolButton>
        <ToolButton
          title="斜体 (Ctrl+I)"
          active={fmt.italic}
          disabled={saving}
          onClick={() => run((e) => e.chain().focus().toggleItalic().run())}
        >
          <Italic size={16} />
        </ToolButton>
        <ToolButton
          title="删除线"
          active={fmt.strike}
          disabled={saving}
          onClick={() => run((e) => e.chain().focus().toggleStrike().run())}
        >
          <Strikethrough size={16} />
        </ToolButton>
        <ToolDivider />
        <ToolButton
          title="标题 1"
          active={fmt.h1}
          disabled={saving}
          onClick={() =>
            run((e) => e.chain().focus().toggleHeading({ level: 1 }).run())
          }
        >
          <Heading1 size={16} />
        </ToolButton>
        <ToolButton
          title="标题 2"
          active={fmt.h2}
          disabled={saving}
          onClick={() =>
            run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())
          }
        >
          <Heading2 size={16} />
        </ToolButton>
        <ToolButton
          title="标题 3"
          active={fmt.h3}
          disabled={saving}
          onClick={() =>
            run((e) => e.chain().focus().toggleHeading({ level: 3 }).run())
          }
        >
          <Heading3 size={16} />
        </ToolButton>
        <ToolDivider />
        <ToolButton
          title="无序列表"
          active={fmt.bullet}
          disabled={saving}
          onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}
        >
          <List size={16} />
        </ToolButton>
        <ToolButton
          title="有序列表"
          active={fmt.ordered}
          disabled={saving}
          onClick={() =>
            run((e) => e.chain().focus().toggleOrderedList().run())
          }
        >
          <ListOrdered size={16} />
        </ToolButton>
        <ToolButton
          title="任务清单 (Ctrl+Shift+9)"
          active={fmt.taskList}
          disabled={saving}
          onClick={() => run((e) => e.chain().focus().toggleTaskList().run())}
        >
          <ListTodo size={16} />
        </ToolButton>
        <ToolButton
          title="引用"
          active={fmt.quote}
          disabled={saving}
          onClick={() => run((e) => e.chain().focus().toggleBlockquote().run())}
        >
          <Quote size={16} />
        </ToolButton>
        <ToolButton
          title="行内代码"
          active={fmt.code}
          disabled={saving}
          onClick={() => run((e) => e.chain().focus().toggleCode().run())}
        >
          <Code size={16} />
        </ToolButton>
        <ToolButton
          title="代码块"
          active={fmt.codeBlock}
          disabled={saving}
          onClick={() => run((e) => e.chain().focus().toggleCodeBlock().run())}
        >
          <CodeXml size={16} />
        </ToolButton>
        {fmt.codeBlock && (
          <select
            className="fs-note-lang-select"
            title="代码语言（语法高亮）"
            aria-label="代码语言"
            disabled={saving}
            value={selectLang}
            onChange={(e) => setCodeLanguage(e.target.value)}
          >
            {CODE_LANGUAGES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {unknownLang !== null && (
              <option key={unknownLang} value={unknownLang}>
                {codeLanguageLabel(unknownLang)}（未收录）
              </option>
            )}
          </select>
        )}
        <ToolDivider />
        <span style={popAnchor} data-fs-tool-pop>
          <ToolButton
            title="链接 (Ctrl+K)"
            active={fmt.linkActive}
            disabled={saving}
            onClick={openLinkPopup}
          >
            <Link2 size={16} />
          </ToolButton>
          {popup === "link" && (
            <div className="fs-note-pop" role="dialog" aria-label="插入链接">
              <p className="fs-note-pop-title">链接（Ctrl+K）</p>
              <input
                className="fs-note-field"
                placeholder={
                  linkDraft.textLocked ? "将包裹选中文字" : "链接文字"
                }
                value={linkDraft.text}
                disabled={saving || linkDraft.textLocked}
                onChange={(e) =>
                  setLinkDraft((d) => ({ ...d, text: e.target.value }))
                }
                onKeyDown={linkFieldKeyDown}
              />
              <input
                className="fs-note-field"
                placeholder="https://…"
                value={linkDraft.url}
                disabled={saving}
                autoFocus
                onChange={(e) =>
                  setLinkDraft((d) => ({ ...d, url: e.target.value }))
                }
                onKeyDown={linkFieldKeyDown}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="fs-note-pop-row">
                {fmt.linkActive && (
                  <button
                    type="button"
                    style={popGhost}
                    onClick={unlinkAtSelection}
                    title="移除链接，保留文字"
                  >
                    移除链接
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" style={popGhost} onClick={closePopup}>
                  取消
                </button>
                <button type="button" style={popPrimary} onClick={applyLink}>
                  确定
                </button>
              </div>
            </div>
          )}
        </span>
        <span style={popAnchor} data-fs-tool-pop>
          <ToolButton
            title="表格"
            active={fmt.inTable}
            disabled={saving}
            onClick={toggleTablePopup}
          >
            <Table2 size={16} />
          </ToolButton>
          {popup === "table" && (
            <div className="fs-note-pop" role="dialog" aria-label="表格">
              {fmt.inTable ? (
                <>
                  <p className="fs-note-pop-title">表格操作</p>
                  <button
                    type="button"
                    className="fs-note-pop-item"
                    onClick={() => tableOp("addRowBefore")}
                  >
                    <ArrowUpToLine size={14} />
                    在上方插入行
                  </button>
                  <button
                    type="button"
                    className="fs-note-pop-item"
                    onClick={() => tableOp("addRowAfter")}
                  >
                    <ArrowDownToLine size={14} />
                    在下方插入行
                  </button>
                  <button
                    type="button"
                    className="fs-note-pop-item"
                    onClick={() => tableOp("addColumnBefore")}
                  >
                    <ArrowLeftToLine size={14} />
                    在左侧插入列
                  </button>
                  <button
                    type="button"
                    className="fs-note-pop-item"
                    onClick={() => tableOp("addColumnAfter")}
                  >
                    <ArrowRightToLine size={14} />
                    在右侧插入列
                  </button>
                  <button
                    type="button"
                    className="fs-note-pop-item"
                    onClick={() => tableOp("deleteRow")}
                  >
                    <Trash2 size={14} />
                    删除当前行
                  </button>
                  <button
                    type="button"
                    className="fs-note-pop-item"
                    onClick={() => tableOp("deleteColumn")}
                  >
                    <Trash2 size={14} />
                    删除当前列
                  </button>
                  <button
                    type="button"
                    className="fs-note-pop-item"
                    onClick={() => tableOp("deleteTable")}
                  >
                    <Trash2 size={14} />
                    删除整个表格
                  </button>
                </>
              ) : (
                <>
                  <p className="fs-note-pop-title">
                    插入表格：{gridSize.cols} 列 × {gridSize.rows} 行
                  </p>
                  <div
                    className="fs-note-pop-grid"
                    onMouseLeave={() => setGridSize({ cols: 3, rows: 2 })}
                  >
                    {Array.from({ length: 6 }, (_, row) => (
                      <div className="fs-note-pop-grid-row" key={row}>
                        {Array.from({ length: 6 }, (_, col) => (
                          <button
                            key={col}
                            type="button"
                            className={`fs-note-pop-grid-cell${
                              col < gridSize.cols && row < gridSize.rows
                                ? " on"
                                : ""
                            }`}
                            onMouseEnter={() =>
                              setGridSize({ cols: col + 1, rows: row + 1 })
                            }
                            onClick={() => insertTableGrid(col + 1, row + 1)}
                            aria-label={`插入 ${col + 1} 列 × ${
                              row + 1
                            } 行表格`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </span>
        <ToolDivider />
        <ToolButton
          title="分隔线"
          disabled={saving}
          onClick={() =>
            run((e) => e.chain().focus().setHorizontalRule().run())
          }
        >
          <Minus size={16} />
        </ToolButton>
        <span style={{ flex: 1 }} />
        <ToolButton
          title="撤销 (Ctrl+Z)"
          disabled={saving || !fmt.canUndo}
          onClick={() => run((e) => e.chain().focus().undo().run())}
        >
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton
          title="重做 (Ctrl+Y)"
          disabled={saving || !fmt.canRedo}
          onClick={() => run((e) => e.chain().focus().redo().run())}
        >
          <Redo2 size={16} />
        </ToolButton>
      </div>

      <div style={contentStyle}>
        <EditorContent editor={editor} />
      </div>

      {/* 任务状态区（合并版）：开关 + 状态选择 + 执行记录/摘要合成底部一块。
          普通便签仅显示开关；已是任务（编辑态）时同块内给状态选择（running 只读
          胶囊 + 提示）与 run 记录；新建任务（initialLaneStatus）只带开关与状态。 */}
      <div style={taskAreaStyle} aria-label="任务状态">
        <div style={taskHeadRow}>
          <label style={laneToggleLabel}>
            <input
              type="checkbox"
              checked={taskOn}
              disabled={saving || runningReadOnly}
              onChange={(e) => {
                setTaskOn(e.target.checked);
                markDirty();
              }}
              style={{
                accentColor: colorMeta.ring,
                cursor: saving || runningReadOnly ? "default" : "pointer",
              }}
            />
            设为任务
          </label>
          {taskOn && !runningReadOnly && (
            <select
              value={taskStatus}
              disabled={saving}
              onChange={(e) => {
                setTaskStatus(e.target.value as TaskStatus);
                markDirty();
              }}
              aria-label="任务状态"
              style={laneSelect}
            >
              {TASK_LANES.map((lane) => (
                <option key={lane.status} value={lane.status}>
                  {lane.label}
                </option>
              ))}
            </select>
          )}
          {taskOn && runningReadOnly && props.initialLane !== undefined && (
            <span style={laneStatusPill} title="当前状态（执行中不可改）">
              {laneLabel(props.initialLane.status)}
            </span>
          )}
          {/* 工作区（任务专属）：与状态选择同行。执行时以该目录**新建会话**跑。
              候选 = 最近会话用过的目录（不给手填新路径）；选项只显示文件夹名，
              完整路径进 title 悬停可见。 */}
          {taskOn && (
            <span style={workspaceField}>
              <span style={workspaceLabel}>工作区</span>
              <select
                value={workspace}
                disabled={saving}
                onChange={(e) => {
                  setWorkspace(e.target.value);
                  markDirty();
                }}
                aria-label="任务执行工作区"
                title={workspaceSelectTitle}
                style={workspaceSelect}
              >
                <option value="">{defaultWorkspaceOptionLabel}</option>
                {workspaceOptions.map((option) => (
                  <option key={option.path} value={option.path} title={option.path}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>
          )}
          {runningReadOnly && (
            <span style={laneHint}>执行中：改状态请先在泳道重置</span>
          )}
        </div>
        {/* 定时执行（任务专属）：到点由 host 调度器自动派发（等价点「执行」，同样新建
            会话 + 投递 + 租约）。一次性 / 间隔 / 每天 / 每周 / 每月；nextAt 由 host 保存时
            重算写回，这里只做编辑与预览（previewNextAt）。 */}
        {taskOn && (
          <div style={scheduleRow} aria-label="定时执行">
            <label style={laneToggleLabel}>
              <input
                type="checkbox"
                checked={schedule?.enabled === true}
                disabled={saving}
                onChange={(e) => {
                  if (e.target.checked) {
                    // 开启 = 授权无人值守执行：先弹行内确认，不确认就不落地。
                    setScheduleConfirm(makeSchedule(schedule?.mode ?? "once", schedule));
                  } else {
                    setScheduleConfirm(undefined);
                    if (schedule !== undefined) setSchedule({ ...schedule, enabled: false });
                    markDirty();
                  }
                }}
                style={{ accentColor: colorMeta.ring, cursor: saving ? "default" : "pointer" }}
              />
              定时
            </label>
            {schedule !== undefined && (
              <>
                <select
                  value={schedule.mode}
                  disabled={saving}
                  aria-label="定时周期"
                  title="定时周期"
                  style={laneSelect}
                  onChange={(e) => {
                    setSchedule(makeSchedule(e.target.value as ScheduleMode, schedule));
                    markDirty();
                  }}
                >
                  {SCHEDULE_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {SCHEDULE_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
                {/* 一次性：绝对时刻（datetime-local，本机时区）。 */}
                {schedule.mode === "once" && (
                  <input
                    type="datetime-local"
                    value={schedule.at !== undefined ? toLocalDateTimeInput(schedule.at) : ""}
                    disabled={saving}
                    aria-label="一次性触发时刻"
                    title="触发时刻"
                    style={scheduleInput}
                    onChange={(e) => {
                      const at = fromLocalDateTimeInput(e.target.value);
                      if (at !== undefined) setSchedule({ ...schedule, at });
                      markDirty();
                    }}
                  />
                )}
                {/* 间隔：数量 + 单位（落库统一为分钟）。 */}
                {schedule.mode === "interval" && (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={intervalUnit === "hour" ? 168 : 1440}
                      value={intervalAmount}
                      disabled={saving}
                      aria-label="间隔时长"
                      title="间隔时长"
                      style={scheduleNumber}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const amount = Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : 1;
                        setSchedule({ ...schedule, everyMin: intervalUnit === "hour" ? amount * 60 : amount });
                        markDirty();
                      }}
                    />
                    <select
                      value={intervalUnit}
                      disabled={saving}
                      aria-label="间隔单位"
                      title="间隔单位"
                      style={laneSelect}
                      onChange={(e) => {
                        const next = e.target.value === "hour" ? "hour" : "min";
                        const minutes = schedule.everyMin ?? 30;
                        setIntervalUnit(next);
                        setSchedule({
                          ...schedule,
                          everyMin: next === "hour" ? Math.max(1, Math.round(minutes / 60)) * 60 : minutes,
                        });
                        markDirty();
                      }}
                    >
                      <option value="min">分钟</option>
                      <option value="hour">小时</option>
                    </select>
                  </>
                )}
                {/* 每周：星期多选（至少一天；host 侧 sanitizeSchedule 同样拒绝空星期）。 */}
                {schedule.mode === "weekly" && (
                  <span style={scheduleChips}>
                    {WEEKDAY_SHORT.map((label, day) => {
                      const active = (schedule.weekdays ?? []).includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          disabled={saving}
                          aria-pressed={active}
                          aria-label={"周" + label}
                          title={"周" + label}
                          onClick={() => {
                            const days = new Set(schedule.weekdays ?? []);
                            if (active) days.delete(day);
                            else days.add(day);
                            if (days.size === 0) return;
                            setSchedule({ ...schedule, weekdays: [...days].sort((a, b) => a - b) });
                            markDirty();
                          }}
                          style={active ? { ...scheduleChip, ...scheduleChipActive } : scheduleChip}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </span>
                )}
                {/* 每月：某日（1-31；当月不足时落在当月最后一天）。 */}
                {schedule.mode === "monthly" && (
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={schedule.monthDay ?? 1}
                    disabled={saving}
                    aria-label="每月第几日"
                    title="每月第几日"
                    style={scheduleNumber}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      if (Number.isFinite(raw)) {
                        setSchedule({ ...schedule, monthDay: Math.min(31, Math.max(1, Math.round(raw))) });
                      }
                      markDirty();
                    }}
                  />
                )}
                {/* 每天/每周/每月共用：当日时刻。 */}
                {schedule.mode !== "once" && schedule.mode !== "interval" && (
                  <input
                    type="time"
                    value={schedule.time ?? "09:00"}
                    disabled={saving}
                    aria-label="触发时刻"
                    title="触发时刻"
                    style={scheduleInput}
                    onChange={(e) => {
                      if (e.target.value !== "") setSchedule({ ...schedule, time: e.target.value });
                      markDirty();
                    }}
                  />
                )}
                <span style={scheduleMeta}>
                  {schedule.enabled
                    ? scheduleNextPreview !== undefined
                      ? "下次：" + fmtDateTime(scheduleNextPreview)
                      : "下次：保存后生效"
                    : "定时已停用"}
                  {schedule.lastResult !== undefined ? " · 上次：" + schedule.lastResult : ""}
                  {(schedule.runCount ?? 0) > 0 ? " · 已跑 " + schedule.runCount + " 次" : ""}
                </span>
                {/* 状态闸门可见：当前列不会被自动执行（拖回「待办」即恢复）。 */}
                {schedule.enabled && scheduleBlockTextFor(taskStatus) !== undefined && (
                  <span style={scheduleWarn}>
                    {scheduleBlockTextFor(taskStatus)}——拖回「待办」即恢复
                  </span>
                )}
                {(schedule.failureStreak ?? 0) > 0 && (
                  <span style={scheduleWarn}>
                    连续失败 {schedule.failureStreak ?? 0} 次
                    {(schedule.failureStreak ?? 0) >= SCHEDULE_MAX_FAILURES
                      ? "（已达上限，日程已停用）"
                      : `（满 ${SCHEDULE_MAX_FAILURES} 次自动停用）`}
                  </span>
                )}
              </>
            )}
            {/* 后果提示：说清「定时」= 无人值守自动执行，不靠用户翻帮助页。 */}
            {schedule !== undefined && (
              <span style={scheduleHint}>
                到点由宿主自动新建会话替你执行（等价于点「执行」），便签板关着也会跑；
                待规划 / 已完成 / 已失败 的卡片不会被自动执行。
              </span>
            )}
          </div>
        )}
        {taskOn &&
          props.initialLane !== undefined &&
          props.initialLane.run !== undefined && (
            <div style={taskRunArea}>
              <div style={laneMetaRow}>
                <span>
                  开始：{fmtDateTime(props.initialLane.run.startedAt)}
                </span>
                {props.initialLane.run.finishedAt !== undefined && (
                  <>
                    <span style={metaDot}>·</span>
                    <span>
                      结束：{fmtDateTime(props.initialLane.run.finishedAt)}
                    </span>
                  </>
                )}
                {props.initialLane.run.ok !== undefined && (
                  <>
                    <span style={metaDot}>·</span>
                    <span>
                      结果：{props.initialLane.run.ok ? "成功" : "失败"}
                    </span>
                  </>
                )}
              </div>
              {props.initialLane.run.summary !== undefined && (
                <>
                  <button
                    type="button"
                    className="fs-note-run-toggle"
                    onClick={() => setRunExpanded((v) => !v)}
                    aria-expanded={runExpanded}
                    title={runExpanded ? "收起执行结果" : "展开执行结果"}
                  >
                    {runExpanded ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    执行结果
                  </button>
                  {runExpanded && (
                    <RunSummaryMarkdown markdown={props.initialLane.run.summary} />
                  )}
                </>
              )}
            </div>
          )}
        {taskOn &&
          props.initialLane !== undefined &&
          props.initialLane.run === undefined && (
            <div style={laneRunMuted}>尚未执行</div>
          )}
      </div>

      {/* 便签纸色选（Win11 便签五色——紫色已随任务泳道分类收敛移除；选中色描边高亮）。 */}
      <div
        style={{
          display: "flex",
          gap: 0,
          alignItems: "flex-end",
          flexWrap: "wrap",
          position: "absolute",
          bottom: 0,
          left: '-5px',
        }}
      >
        {NOTE_COLOR_PALETTE.map((c) => (
          <button
            key={c.id}
            type="button"
            className="fs-note-color"
            title={`${c.label}色便签`}
            aria-label={`设为${c.label}色`}
            aria-pressed={color === c.id}
            disabled={saving}
            onClick={() => {
              setColor(c.id);
              props.onColorChange?.(c.id);
              markDirty();
            }}
            style={{
              ...colorDot,
              background: c.paper,
              height: color === c.id ? 40 : 30,
              ...(saving ? { cursor: "default", opacity: 0.5 } : {}),
            }}
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        {props.autoSave === true && (
          <span
            role="status"
            style={autoSaveHint}
            title={
              lastSavedAt.current !== null
                ? `上次自动保存：${fmtDateTime(lastSavedAt.current)}（Ctrl+S 可立即保存）`
                : "编辑停顿约 1 秒自动保存；Ctrl+S 立即保存——两者都不关闭弹窗"
            }
          >
            {autoSaveHintText}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="fs-note-btn"
          style={btnGhost}
          disabled={saving}
          onClick={props.onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="fs-note-btn fs-note-btn-primary"
          style={{ ...btnPrimary, ...(saving ? disabledBtn : {}) }}
          disabled={saving}
          title="保存并关闭（Ctrl+Enter；只保存不关闭用 Ctrl+S）"
          onClick={() => void save()}
        >
          <Check size={14} />
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {/* 开启「定时」前的确认弹窗：把「到点会自己开 agent 跑」这件事说清楚再授权。
          点开关只弹窗不落地，确认后才写进草稿（与其它字段一样等保存生效）。 */}
      {scheduleConfirm !== undefined && (
        <ConfirmDialog
          title="开启定时执行？"
          description="到点由宿主自动新建会话替你执行（等价于点「执行」），便签板关着也会跑。"
          accent={colorMeta.ring}
          bullets={[
            `周期：${scheduleLabel(scheduleConfirm)}${
              (() => {
                const next = previewNextAt(scheduleConfirm);
                return next !== undefined ? `，下次 ${fmtDateTime(next)}` : "（保存后按当前时刻计算）";
              })()
            }`,
            `工作区：${workspace.trim() !== "" ? workspace : defaultWorkspaceOptionLabel}`,
            "待规划 / 已完成 / 已失败 的卡片不会被自动执行（拖回「待办」即恢复）",
            `连续失败 ${SCHEDULE_MAX_FAILURES} 次自动停用；单次执行超过 ${
              SCHEDULE_RUN_TIMEOUT_MS / 60_000
            } 分钟未收尾按失败收尾`,
          ]}
          confirmLabel="开启定时"
          onConfirm={() => {
            setSchedule(scheduleConfirm);
            setScheduleConfirm(undefined);
            markDirty();
          }}
          onCancel={() => setScheduleConfirm(undefined)}
        />
      )}
    </div>
  );
}

/* ---------- 操作栏小组件 ---------- */

function ToolButton(props: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="fs-note-tool"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        ...toolBtn,
        ...(props.active
          ? { background: "rgba(46, 42, 34, 0.14)", color: "#2E2A22" }
          : {}),
        ...(props.disabled ? { cursor: "default", opacity: 0.35 } : {}),
      }}
    >
      {props.children}
    </button>
  );
}

function ToolDivider(): JSX.Element {
  return (
    <span
      style={{ width: 1, height: 16, background: "rgba(46, 42, 34, 0.22)", margin: "0 2px" }}
    />
  );
}

/* ---------- 样式 ---------- */

/** 头部行：便签标题直接放 header（纸面墨迹、无输入框边框），右侧关闭钮。 */
const headRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};
/** 便签标题输入（纸卡 header 直写，无边框无底色，像写在纸上）。 */
const headTitleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  boxSizing: "border-box",
  padding: "2px 4px",
  fontSize: 17,
  fontWeight: 600,
  lineHeight: 1.4,
  color: NOTE_INK,
  background: "transparent",
  border: "none",
  outline: "none",
};
/** 头部关闭钮（右上角）。 */
const headCloseBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  width: 26,
  height: 26,
  padding: 0,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: NOTE_INK_MUTED,
  cursor: "pointer",
};
/** 正文书写区：不再有边框/底框 —— 直接写在便签纸上。 */
const contentStyle: React.CSSProperties = {
  padding: "0 4px",
  color: NOTE_INK,
  background: "transparent",
  maxHeight: "70vh",
  overflowY: "auto",
};
const toolBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  border: "none",
  borderRadius: 7,
  background: "transparent",
  color: "rgba(46, 42, 34, 0.75)",
  cursor: "pointer",
};
const btnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 30,
  padding: "0 14px",
  border: "none",
  borderRadius: 10,
  fontSize: 13,
  cursor: "pointer",
  lineHeight: 1,
};
const btnGhost: React.CSSProperties = {
  ...btnBase,
  color: NOTE_INK,
  background: "transparent",
};
const colorDot: React.CSSProperties = {
  width: 20,
  height: 20,
  padding: 0,
  border: "none",
  // borderRadius: '50%',
  cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  ...btnBase,
  color: "#FFFDF4",
  background: NOTE_INK,
  fontWeight: 600,
};
const disabledBtn: React.CSSProperties = { opacity: 0.5, cursor: "default" };

/* 工具栏弹层锚点与弹层内按钮。 */
const popAnchor: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
};
const popGhost: React.CSSProperties = {
  ...btnBase,
  height: 26,
  padding: "0 10px",
  fontSize: 12.5,
  color: t.labelPrimary,
  background: "transparent",
};
const popPrimary: React.CSSProperties = {
  ...btnBase,
  height: 26,
  padding: "0 10px",
  fontSize: 12.5,
  color: t.onPrimary,
  background: t.primaryFill,
  fontWeight: 600,
};

/* ---------- 任务状态区（合并版，纸面无边框） ---------- */

/** 任务区整块：纸底淡墨染层、无边框圆角（不做输入框的盒子感）。 */
const taskAreaStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 10,
  background: PAPER_DEEP_TINT,
};
/** 任务区头部行：开关 + 状态选择（或 running 胶囊）+ 提示。 */
const taskHeadRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};
const laneToggleLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 13,
  color: NOTE_INK,
  cursor: "pointer",
};
const laneStatusPill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 20,
  padding: "0 8px",
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 600,
  color: NOTE_INK,
  background: PAPER_SOFT_FILL,
};
const laneSelect: React.CSSProperties = {
  height: 26,
  padding: "0 6px",
  fontSize: 12.5,
  color: "rgba(46, 42, 34, 0.85)",
  background: "transparent",
  border: "none",
  borderRadius: 7,
  outline: "none",
  cursor: "pointer",
};
/** 自动保存指示灯：页脚最左，弱化存在感（墨迹系灰）。 */
const autoSaveHint: React.CSSProperties = {
  fontSize: 11.5,
  color: "rgba(46, 42, 34, 0.5)",
};
const laneHint: React.CSSProperties = {
  fontSize: 12,
  color: "#b3261e",
};
/** 工作区控件（与状态选择同行）：标签 + 下拉，命中「自定义」时才展开手填输入。 */
const workspaceField: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  flex: "1 1 200px",
  minWidth: 0,
};
const workspaceLabel: React.CSSProperties = {
  flex: "none",
  fontSize: 12.5,
  color: NOTE_INK_MUTED,
};
const workspaceSelect: React.CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  maxWidth: "100%",
  height: 26,
  padding: "0 4px",
  fontSize: 12.5,
  color: "rgba(46, 42, 34, 0.85)",
  background: PAPER_SOFT_FILL,
  border: "none",
  borderRadius: 7,
  outline: "none",
  cursor: "pointer",
};
/** 定时行：独占一行（开关 + 周期 + 参数 + 下次/上次），窄弹窗内自动换行。 */
const scheduleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
};
/** 定时行里的后果说明 / 失败警示（整行，弱化字号）。 */
const scheduleHint: React.CSSProperties = {
  flex: "1 1 100%",
  fontSize: 11.5,
  lineHeight: 1.5,
  color: NOTE_INK_MUTED,
};
const scheduleWarn: React.CSSProperties = {
  fontSize: 11.5,
  color: t.danger,
};
/** 定时参数输入（datetime-local / time）：与工作区下拉同款墨迹系浅底填充。 */
const scheduleInput: React.CSSProperties = {
  height: 26,
  padding: "0 4px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "rgba(46, 42, 34, 0.85)",
  background: PAPER_SOFT_FILL,
  border: "none",
  borderRadius: 7,
  outline: "none",
};
/** 数量输入（间隔时长 / 每月第几日）：窄，免得把整行撑开。 */
const scheduleNumber: React.CSSProperties = { ...scheduleInput, width: 58 };
/** 星期多选容器。 */
const scheduleChips: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  flexWrap: "wrap",
};
/** 星期胶囊（未选）：浅底墨迹。 */
const scheduleChip: React.CSSProperties = {
  minWidth: 22,
  height: 22,
  padding: "0 5px",
  fontSize: 11.5,
  lineHeight: 1,
  boxSizing: "border-box",
  color: "rgba(46, 42, 34, 0.75)",
  background: PAPER_SOFT_FILL,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
/** 星期胶囊（已选）：深墨底反白，纸质卡面上对比恒定。 */
const scheduleChipActive: React.CSSProperties = {
  background: "rgba(46, 42, 34, 0.72)",
  color: "#ffffff",
  fontWeight: 600,
};
/** 定时行尾的「下次/上次」小字（弱化，别抢正文视线）。 */
const scheduleMeta: React.CSSProperties = {
  fontSize: 11.5,
  color: NOTE_INK_MUTED,
  flex: "1 1 160px",
  minWidth: 0,
};
/** 执行记录区：开始/结束/结果一行（· 分隔）+ 摘要。 */
const taskRunArea: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const laneMetaRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: 5,
  fontSize: 12.5,
  color: NOTE_INK_MUTED,
  lineHeight: 1.6,
};
const metaDot: React.CSSProperties = {
  color: "rgba(46, 42, 34, 0.32)",
};
/** run.summary 只读 markdown 的内层排版覆盖（嵌套在编辑器内，见 RunSummaryMarkdown）。 */
const RUN_SUMMARY_PREVIEW_CSS = `
.fs-note-run-summary { padding: 0; max-height: 36vh; overflow-y: auto; }
.fs-note-run-summary .ProseMirror { min-height: 0; caret-color: transparent; }
`;
const laneRunMuted: React.CSSProperties = {
  fontSize: 12.5,
  color: "rgba(46, 42, 34, 0.45)",
};
