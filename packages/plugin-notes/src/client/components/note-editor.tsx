/**
 * 便签编辑器（tiptap + Markdown）：标题输入 + 富文本正文 + 格式操作栏。
 * - 正文经 tiptap-markdown 序列化保存为真实 Markdown（不再丢格式）；
 * - 操作栏：粗体/斜体/删除线/标题H1-H3/无序·有序列表/引用/代码块/分隔线/撤销/重做；
 * - 粘贴图片：剪贴板图片文件 → data URL 内联插入正文（![图](data:...)）；
 * - 快捷键：Ctrl/Cmd+Enter 保存，Esc 取消。
 * 父组件用 key 控制实例重建（新建/每条便签各一个编辑器），初值即草稿内容。
 */

import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import type { MarkdownStorage } from "tiptap-markdown";
import { DEFAULT_NOTE_COLOR } from "../../types.ts";
import type { NoteColor } from "../../types.ts";
import { NOTE_COLOR_PALETTE } from "../core/note-colors.ts";
import { fileToDataUrl, pickImageFiles } from "../core/paste-image.ts";
import { t } from "../core/theme-tokens.ts";
import {
  Bold,
  Check,
  Code,
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";

export interface NoteEditorProps {
  readonly initialTitle: string;
  readonly initialBody: string;
  /** 便签纸颜色（缺省默认黄）。 */
  readonly initialColor?: NoteColor;
  /** 标题留空时使用的默认标题（来自设置）。 */
  readonly defaultTitle: string;
  readonly onCancel: () => void;
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
  ) => void | Promise<void>;
}

/** 编辑器内容区排版（tiptap 生成的 HTML 在此样式化；令牌取色，明暗自适应）。 */
const EDITOR_CSS = `
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
.fs-note-editor .ProseMirror a { color: var(--dsw-static-deepseek-450); }
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
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * 便签图片节点：官方 @tiptap/extension-image。
 * - allowBase64: true —— 粘贴的图片以 base64 data URL 进正文，官方扩展默认
 *   parseHTML 是 img[src]:not([src^="data:"])，不开此选项 data URL 图会被跳过；
 * - inline: true —— 图片作为行内原子插在段落文字中，随 Markdown 一起保存/加载。
 */
const NoteImage = Image.configure({ inline: true, allowBase64: true });

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
  const [saving, setSaving] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit, Markdown, NoteImage],
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
      await props.onSave(trimmed || props.defaultTitle, body, color);
    } finally {
      setSaving(false);
    }
  }

  function run(fn: (e: Editor) => void): void {
    if (editor) fn(editor);
  }

  return (
    <div
      className="fs-note-editor"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          props.onCancel();
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
