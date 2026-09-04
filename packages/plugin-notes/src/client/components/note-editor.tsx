/**
 * 便签编辑器（tiptap + Markdown）：标题输入 + 富文本正文 + 格式操作栏。
 * - 正文经 tiptap-markdown 序列化保存为真实 Markdown（不再丢格式）；
 * - 操作栏：粗体/斜体/删除线/标题H1-H3/无序·有序列表/引用/行内代码/代码块
 *   （+ 语言选择）/分隔线/链接（弹层设置）/表格（插入·行列操作）/撤销/重做；
 * - 代码块语言高亮、链接与表格能力来自共享扩展层 core/note-richtext.ts
 *   （note-preview 只读渲染复用同一套，保证编辑与展示一致）；
 * - 粘贴图片：剪贴板图片文件 → data URL 内联插入正文（![图](data:...)）；
 * - 快捷键：Ctrl/Cmd+Enter 保存，Esc 关闭弹层或取消，Ctrl/Cmd+K 插入链接。
 * 父组件用 key 控制实例重建（新建/每条便签各一个编辑器），初值即草稿内容。
 */

import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { MarkdownStorage } from "tiptap-markdown";
import { DEFAULT_NOTE_COLOR } from "../../types.ts";
import type { NoteColor, NoteLane, TaskStatus } from "../../types.ts";
import { NOTE_COLOR_PALETTE } from "../core/note-colors.ts";
import { TASK_LANES, isRunOpen, laneLabel } from "../core/task-lanes.ts";
import { fmtDateTime } from "../core/time-text.ts";
import { fileToDataUrl, pickImageFiles } from "../core/paste-image.ts";
import { t } from "../core/theme-tokens.ts";
import { buildNoteRichTextExtensions } from "../core/note-richtext.ts";
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
  Code,
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";

// 图片扩展定义挪至共享层 core/note-richtext.ts，此处仅再导出保持兼容。
export { NoteImage } from "../core/note-richtext.ts";

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
  /** 标题留空时使用的默认标题（来自设置）。 */
  readonly defaultTitle: string;
  readonly onCancel: () => void;
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
    lanePatch: { readonly on: boolean; readonly status: TaskStatus },
  ) => void | Promise<void>;
}

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
.fs-note-editor .ProseMirror p:has(> img) {  }
.fs-note-editor .ProseMirror img.ProseMirror-selectednode { outline: 2px solid var(--dsw-static-deepseek-450); }
.fs-note-editor .ProseMirror ::selection { background: var(--dsw-specific-bubble-highlight); }
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
`;

type FormatState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  h1: boolean;
  h2: boolean;
  h3: boolean;
  bullet: boolean;
  ordered: boolean;
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
  /** 「设为任务」开关：既有任务（initialLane）或列头新建预填（initialLaneStatus）即开。 */
  const [taskOn, setTaskOn] = useState(
    props.initialLane !== undefined || props.initialLaneStatus !== undefined,
  );
  /** 任务状态选择：编辑态预选当前状态，新建态预填列状态，否则默认待办。 */
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(
    props.initialLane?.status ?? props.initialLaneStatus ?? "todo",
  );
  /** 编辑 running 任务（isRunOpen）：开关与状态只读（改状态请先在泳道重置）。 */
  const runningReadOnly =
    props.initialLane !== undefined && isRunOpen(props.initialLane);
  const [saving, setSaving] = useState(false);
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
    extensions: buildNoteRichTextExtensions(),
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

  async function save(): Promise<void> {
    const body = editorMarkdown(editor, props.initialBody);
    const trimmed = title.trim();
    if (!trimmed && !body) {
      props.onCancel();
      return;
    }
    setSaving(true);
    try {
      await props.onSave(trimmed || props.defaultTitle, body, color, {
        on: taskOn,
        status: taskStatus,
      });
    } finally {
      setSaving(false);
    }
  }

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

  /** 规范化地址：无 scheme 时补 https://（mailto:/note:/file: 等保留）。 */
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
      className="fs-note-editor"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          void save();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          openLinkPopup();
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

      <input
        autoFocus={!props.initialBody.trim()}
        placeholder="标题（留空使用默认标题）"
        value={title}
        disabled={saving}
        onChange={(e) => setTitle(e.target.value)}
        style={titleStyle}
      />

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

      {/* 只读「任务与结果」区（编辑已有任务，spec M4）：正文下方渲染当前状态 + run
          执行结果全文；新建态无此区。读的是 initialLane（本次编辑前的既有状态），
          不随开关临时状态变化。 */}
      {props.initialLane !== undefined && (
        <div style={laneResultStyle} aria-label="任务与结果">
          <div style={laneResultHead}>
            <span style={laneResultLabel}>任务状态</span>
            <span style={laneStatusPill}>
              {laneLabel(props.initialLane.status)}
            </span>
          </div>
          {props.initialLane.run !== undefined ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={laneRunRow}>
                开始：{fmtDateTime(props.initialLane.run.startedAt)}
              </div>
              {props.initialLane.run.finishedAt !== undefined && (
                <div style={laneRunRow}>
                  结束：{fmtDateTime(props.initialLane.run.finishedAt)}
                </div>
              )}
              {props.initialLane.run.ok !== undefined && (
                <div style={laneRunRow}>
                  结果：{props.initialLane.run.ok ? "成功" : "失败"}
                </div>
              )}
              {props.initialLane.run.summary !== undefined && (
                <div style={laneRunSummary}>
                  {props.initialLane.run.summary}
                </div>
              )}
            </div>
          ) : (
            <div style={laneRunMuted}>尚未执行</div>
          )}
        </div>
      )}

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
            onClick={() => setColor(c.id)}
            style={{
              ...colorDot,
              background: c.paper,
              height: color === c.id ? 40 : 30,
              ...(saving ? { cursor: "default", opacity: 0.5 } : {}),
            }}
          />
        ))}
      </div>

      {/* 任务开关（M2）：「设为任务」checkbox + 状态 select（新建默认待办；编辑预选当前
          状态；running 时只读并提示改状态先重置）。 */}
      <div style={laneToggleRow}>
        <label style={laneToggleLabel}>
          <input
            type="checkbox"
            checked={taskOn}
            disabled={saving || runningReadOnly}
            onChange={(e) => setTaskOn(e.target.checked)}
            style={{
              accentColor: t.pinAccent,
              cursor: saving || runningReadOnly ? "default" : "pointer",
            }}
          />
          设为任务
        </label>
        {taskOn && (
          <select
            value={taskStatus}
            disabled={saving || runningReadOnly}
            onChange={(e) => setTaskStatus(e.target.value as TaskStatus)}
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
        {runningReadOnly && (
          <span style={laneHint}>执行中：改状态请先在泳道重置</span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
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
          onClick={() => void save()}
        >
          <Check size={14} />
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
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
          ? { background: t.activeBg, color: t.labelPrimary }
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
      style={{ width: 1, height: 16, background: t.borderL2, margin: "0 2px" }}
    />
  );
}

/* ---------- 样式 ---------- */

const titleStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 10px",
  fontSize: 15,
  fontWeight: 600,
  color: t.labelPrimary,
  background: "transparent",
  border: `1px solid ${t.borderL2}`,
  borderRadius: 8,
  outline: "none",
};
const contentStyle: React.CSSProperties = {
  border: `1px solid ${t.borderL2}`,
  borderRadius: 10,
  padding: "8px 12px",
  background: t.surfaceRaised,
  maxHeight: '70Vh',
  minWidth: '400PX',
  overflow: 'scroll'
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
  color: t.labelSecondary,
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
  color: t.labelPrimary,
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
  color: t.onPrimary,
  background: t.primaryFill,
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

/* ---------- 任务开关 / 只读结果区 ---------- */

const laneResultStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "8px 10px",
  border: `1px solid ${t.borderL2}`,
  borderRadius: 8,
  background: t.surfaceRaised,
};
const laneResultHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
};
const laneResultLabel: React.CSSProperties = {
  fontSize: 12,
  color: t.labelSecondary,
};
const laneStatusPill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 20,
  padding: "0 8px",
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 600,
  color: t.labelPrimary,
  background: t.hoverBg,
};
const laneRunRow: React.CSSProperties = {
  fontSize: 12.5,
  color: t.labelSecondary,
  lineHeight: 1.6,
};
const laneRunSummary: React.CSSProperties = {
  fontSize: 12.5,
  color: t.labelPrimary,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
const laneRunMuted: React.CSSProperties = {
  fontSize: 12.5,
  color: t.labelCaption,
};
const laneToggleRow: React.CSSProperties = {
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
  color: t.labelPrimary,
  cursor: "pointer",
};
const laneSelect: React.CSSProperties = {
  height: 26,
  padding: "0 6px",
  fontSize: 12.5,
  color: t.labelSecondary,
  background: "transparent",
  border: `1px solid ${t.borderL2}`,
  borderRadius: 7,
  outline: "none",
  cursor: "pointer",
};
const laneHint: React.CSSProperties = {
  fontSize: 12,
  color: t.stateWarn,
};
