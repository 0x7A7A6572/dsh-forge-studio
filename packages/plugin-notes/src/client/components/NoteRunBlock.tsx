/**
 * 任务便签的「执行记录」零件：一行运行起止/耗时/结果 + 可折叠的 agent 摘要。
 *
 * 摘要走只读 tiptap 实例渲染 markdown（复用 NoteEditor 那套正文排版栈 /
 * styles/notes-editor.module.css），保证与便签正文观感一致。
 * 从 note-editor 拆出（原文件 2000 行）：这两个组件只在「任务与结果」区出现，
 * 与编辑器主体没有共享状态，是标准零件。
 */
import { EditorContent, useEditor } from '@tiptap/react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { NoteLane } from '../../types.ts'
import { fmtElapsed, fmtShortDateTime } from '../core/time-text.ts'
import { buildNoteRichTextExtensions } from '../core/note-richtext.ts'
import { t } from '../core/theme-tokens.ts'
import { NOTE_INK_MUTED } from '../core/note-colors.ts'
import styles from '../styles/notes-editor.module.css'

/** 只读 markdown 渲染（正文观感）：run.summary 是 agent 写回的 markdown 总结，
 * 不能用纯文本展示。复用正文同款排版栈（notes-editor.module.css 的 editor/preview/
 * runSummary 三件），观感与便签正文一致 —— 链接可点开、代码高亮/表格同源。 */
function RunSummaryMarkdown(props: { readonly markdown: string }): JSX.Element {
  const editor = useEditor({
    extensions: buildNoteRichTextExtensions({ readonly: true }),
    content: props.markdown,
    editable: false,
  });
  return (
    <div className={`${styles.editor} ${styles.preview} ${styles.runSummary}`}>
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * 执行记录块：一行「运行 起 → 止 · 耗时 · 结果」+ 可折叠的 agent 摘要。
 * 定时卡片把它收进「详情」（默认不占版面），非定时卡片原地展示——同一份实现由调用处
 * 决定挂在哪儿，避免两套渲染走样。
 */
export function LaneRunBlock(props: {
  readonly run: NonNullable<NoteLane["run"]>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  const run = props.run;
  return (
    <div style={taskRunArea}>
      <div style={laneMetaRow}>
        <span>
          运行 {fmtShortDateTime(run.startedAt)}
          {run.finishedAt !== undefined && " → " + fmtShortDateTime(run.finishedAt)}
          {run.finishedAt !== undefined && " · " + fmtElapsed(run.finishedAt - run.startedAt)}
        </span>
        {run.ok !== undefined && (
          <>
            <span style={metaDot}>·</span>
            <span style={run.ok ? runOkText : runFailText}>{run.ok ? "成功" : "失败"}</span>
          </>
        )}
      </div>
      {run.summary !== undefined && (
        <>
          <button
            type="button"
            className={styles.runToggle}
            onClick={props.onToggle}
            aria-expanded={props.expanded}
            title={props.expanded ? "收起执行结果" : "展开执行结果"}
          >
            {props.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            执行结果
          </button>
          {props.expanded && <RunSummaryMarkdown markdown={run.summary} />}
        </>
      )}
    </div>
  );
}

/* ---------- 样式 ---------- */

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
const runOkText: React.CSSProperties = { color: t.success };
const runFailText: React.CSSProperties = { color: t.danger };
