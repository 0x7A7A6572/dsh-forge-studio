/**
 * 便签 Markdown「只读渲染」组件：复用便签编辑器同款渲染栈与排版
 * （core/note-richtext.ts 的 buildNoteRichTextExtensions + styles/notes-editor.module.css
 * 的 .editor/.preview 排版层），以 editable:false 的 tiptap 只读实例静态展示 markdown，
 * 观感与便签正文一致 —— 链接/表格/代码语言高亮与编辑器同源。
 *
 * 用途：便签板「使用说明」弹窗等把 markdown 常量按便签正文观感渲染的场合。
 * 与编辑器的差异仅是只读：
 * - 不注册粘贴守卫、不触发任何保存流（纯展示，数据零接触）；
 * - 链接 openOnClick=true，可直接点开；
 * - 排版覆盖点：去掉编辑器输入框式 min-height 与光标色约束。
 */

import { EditorContent, useEditor } from '@tiptap/react';
import { buildNoteRichTextExtensions } from '../core/note-richtext.ts';
import editorStyles from '../styles/notes-editor.module.css';

export interface NoteMarkdownViewProps {
  /** 待渲染的 markdown 正文（只读展示）。 */
  readonly markdown: string;
}

export function NoteMarkdownView(props: NoteMarkdownViewProps): JSX.Element {
  const editor = useEditor({
    extensions: buildNoteRichTextExtensions({ readonly: true }),
    content: props.markdown,
    editable: false,
  });
  return (
    <div className={`${editorStyles.editor} ${editorStyles.preview}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
