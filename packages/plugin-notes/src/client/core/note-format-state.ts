/**
 * 编辑器格式态：从 tiptap Editor 读出「光标处有哪些标记开着」的快照。
 *
 * 纯计算（只读 editor 状态、不碰 DOM、不 import react），所以放 core/ —— 工具栏
 * 与「正文 Markdown 取值」两侧共用同一份判定。
 */
import type { Editor } from '@tiptap/core'
import type { MarkdownStorage } from 'tiptap-markdown'

export type FormatState = {
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

export const EMPTY_FORMAT: FormatState = {
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

export function formatOf(editor: Editor | null): FormatState {
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

/** 取编辑器当前 Markdown 正文；编辑器未就绪时回退初值。 */
export function editorMarkdown(editor: Editor | null, fallback: string): string {
  if (!editor) return fallback.trim();
  const storage = editor.storage?.markdown as MarkdownStorage | undefined;
  return (storage?.getMarkdown() ?? editor.getText()).trim();
}
