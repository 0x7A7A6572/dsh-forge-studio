/**
 * 便签编辑器的全部状态与动作，视图只解构返回值。
 * 关闭只有一道闸：所有入口都汇到 requestClose，少接一条就会静默丢改动。
 */

import { useEffect, useMemo, useRef, useState } from "react"
import type { MutableRefObject } from "react"
import { useEditor, useEditorState } from "@tiptap/react"
import type { Editor } from "@tiptap/core"
import { DEFAULT_NOTE_COLOR } from "../../types.ts"
import type {
  NoteColor,
  NoteLane,
  NoteModelSelection,
  NoteScheduleInput,
  TaskStatus,
  TaskTargets,
} from "../../types.ts"
import { previewNextAt } from "../../schedule.ts"
import { noteColorMeta } from "../core/note-colors.ts"
import {
  isRunOpen,
  laneLabel,
  modelKey,
  modelSelectGroups,
  parseModelKey,
} from "../core/task-lanes.ts"
import { createAutoSaver, type AutoSaver } from "../core/auto-save.ts"
import {
  isNoteDraftDirty,
  noteDraftSignature,
  type NoteDraftFields,
} from "../core/note-draft-diff.ts"
import { fmtCountdown, fmtDateTime, fmtShortDateTime } from "../core/time-text.ts"
import { folderNameOf, workspaceSelectOptions } from "../core/workspace-path.ts"
import { buildNoteRichTextExtensions } from "../core/note-richtext.ts"
import { NoteImageResizable } from "../components/NoteImageResizeView.tsx"
import { CODE_LANGUAGES } from "../core/code-languages.ts"
import { EMPTY_FORMAT, editorMarkdown, formatOf } from "../core/note-format-state.ts"
import { liveEditors, registerPasteGuard } from "../core/note-paste-guard.ts"

const AUTO_SAVE_DELAY_MS = 1200;
const AUTO_SAVE_RETRY_MS = 500;

export interface NoteSaveOptions {
  readonly close?: boolean;
  readonly silent?: boolean;
}

/** 任务草稿 patch：空串/undefined = 未指定，已停用的日程仍是 enabled:false 对象。 */
export interface NoteTaskDraft {
  readonly on: boolean;
  readonly status: TaskStatus;
  readonly workspace: string;
  readonly agentPreset: string;
  readonly model?: NoteModelSelection;
  readonly schedule?: NoteScheduleInput;
}

export interface NoteEditorProps {
  readonly initialTitle: string;
  readonly initialBody: string;
  readonly initialColor?: NoteColor;
  /** 存在即任务便签；isRunOpen 时开关与状态只读。 */
  readonly initialLane?: NoteLane;
  /** 仅创建态使用（列头「＋新建任务」）：非空即预填开关 + 该状态。 */
  readonly initialLaneStatus?: TaskStatus;
  /** 执行时以该目录新建会话；任务没有工作区就执行不了。 */
  readonly initialWorkspace?: string;
  /** undefined = 不定时；只有任务便签才有意义。 */
  readonly initialSchedule?: NoteScheduleInput;
  readonly onColorChange?: (color: NoteColor) => void;
  readonly defaultTitle: string;
  /** 最近会话用过的 cwd；下拉只选不手填。 */
  readonly workspaceOptions?: readonly string[];
  /** 未就绪时占位项不写「（无候选）」。 */
  readonly workspaceReady?: boolean;
  /** 空目录 = 只有「宿主默认」可选。 */
  readonly taskTargets?: TaskTargets;
  /** 编辑既有便签才开：停顿自动保存，不关弹窗。 */
  readonly autoSave?: boolean;
  /** 编辑器外那几条关闭路径（遮罩 / 浮层 / 板子）由此 ref 走同一道闸。 */
  readonly requestCloseRef?: MutableRefObject<(() => void) | null>;
  readonly onCancel: () => void;
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: NoteTaskDraft,
    options?: NoteSaveOptions,
  ) => void | Promise<void>;
}

export function useNoteEditor(props: NoteEditorProps) {
  const [title, setTitle] = useState(props.initialTitle);
  const [color, setColor] = useState<NoteColor>(
    props.initialColor ?? DEFAULT_NOTE_COLOR,
  );
  const colorMeta = noteColorMeta(color);
  const [taskOn, setTaskOn] = useState(
    props.initialLane !== undefined || props.initialLaneStatus !== undefined,
  );
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(
    props.initialLane?.status ?? props.initialLaneStatus ?? "todo",
  );
  /** 留空 = 存不进库（任务必须有工作区）。 */
  const [workspace, setWorkspace] = useState(props.initialWorkspace ?? "");
  /** 模型存的是 select value（modelKey 编码），落库前经 parseModelKey 还原。 */
  const [agentPreset, setAgentPreset] = useState(props.initialLane?.agentPreset ?? "");
  const [modelValue, setModelValue] = useState(() => modelKey(props.initialLane?.model));
  const selectedModel = parseModelKey(modelValue);
  /** 目录 + 当前值兜底项；依赖 modelValue，换选后旧值不再占位。 */
  const modelOptionGroups = useMemo(
    () => modelSelectGroups(props.taskTargets?.models ?? [], selectedModel),
    [props.taskTargets, modelValue],
  );
  const presetOptions = useMemo(() => {
    const list = [...(props.taskTargets?.presets ?? [])];
    const chosen = agentPreset.trim();
    if (chosen !== "" && !list.some((entry) => entry.id === chosen)) {
      list.push({ id: chosen, name: chosen + "（不在当前目录）" });
    }
    return list;
  }, [props.taskTargets, agentPreset]);
  /** 列头新建任务、或已有执行结果（done/failed）时默认展开。 */
  const [taskDetailOpen, setTaskDetailOpen] = useState(
    props.initialLaneStatus !== undefined
    || props.initialLane?.status === "done"
    || props.initialLane?.status === "failed",
  );
  /** nextAt 由 host 保存时重算写回，这里只用于编辑与预览。 */
  const [schedule, setSchedule] = useState<NoteScheduleInput | undefined>(props.initialSchedule);
  /** 开启定时的行内确认草稿：不确认就不写进 schedule。 */
  const [scheduleConfirm, setScheduleConfirm] = useState<NoteScheduleInput | undefined>(undefined);
  /** 只影响展示换算；落库统一为分钟（everyMin）。 */
  const [intervalUnit, setIntervalUnit] = useState<"min" | "hour">(() => {
    const minutes = props.initialSchedule?.everyMin ?? 30;
    return minutes % 60 === 0 && minutes >= 60 ? "hour" : "min";
  });
  const intervalAmount =
    schedule?.everyMin === undefined
      ? 30
      : intervalUnit === "hour"
        ? schedule.everyMin / 60
        : schedule.everyMin;
  const scheduleNextPreview = schedule !== undefined ? previewNextAt(schedule) : undefined;
  const scheduleNextText =
    schedule === undefined
      ? ""
      : !schedule.enabled
        ? "定时已停用"
        : scheduleNextPreview !== undefined
          ? fmtShortDateTime(scheduleNextPreview) + " · " + fmtCountdown(scheduleNextPreview)
          : "保存后生效";
  const scheduleSummaryTitle =
    schedule === undefined
      ? ""
      : schedule.enabled && scheduleNextPreview !== undefined
        ? "下次：" + fmtDateTime(scheduleNextPreview)
        : scheduleNextText;
  const workspaceOptions = useMemo(
    () => workspaceSelectOptions(props.workspaceOptions ?? [], workspace),
    [props.workspaceOptions, workspace],
  );
  const workspacePlaceholder = props.workspaceReady === false ? "选择工作区…" : "选择工作区（无候选）";
  const workspaceSelectTitle = workspace !== "" ? `工作区：${workspace}` : "尚未指定工作区";
  const taskWorkspaceMissing = taskOn && workspace.trim() === "";
  const modelLabel = useMemo(() => {
    for (const group of modelOptionGroups) {
      const hit = group.options.find((option) => option.key === modelValue);
      if (hit !== undefined) return hit.label;
    }
    return selectedModel?.model ?? "";
  }, [modelOptionGroups, modelValue, selectedModel]);
  const presetLabel =
    agentPreset.trim() === ""
      ? ""
      : (presetOptions.find((entry) => entry.id === agentPreset.trim())?.name ?? agentPreset.trim());
  const taskSummaryParts = [
    laneLabel(taskStatus),
    workspace.trim() === "" ? "未选工作区" : folderNameOf(workspace),
    modelLabel === "" ? "" : modelLabel,
    presetLabel === "" ? "" : "预设 " + presetLabel,
  ].filter((part) => part !== "");
  const taskSummaryText = taskSummaryParts.join(" · ");
  const runningReadOnly =
    props.initialLane !== undefined && isRunOpen(props.initialLane);
  const [saving, setSaving] = useState(false);
  const [runExpanded, setRunExpanded] = useState(false);
  const [scheduleDetailOpen, setScheduleDetailOpen] = useState(false);

  const [popup, setPopup] = useState<"link" | "table" | null>(null);
  /** textLocked = 选区非空，文字由选中内容决定。 */
  const [linkDraft, setLinkDraft] = useState<{
    text: string;
    url: string;
    textLocked: boolean;
  }>({ text: "", url: "", textLocked: false });
  const [gridSize, setGridSize] = useState({ cols: 3, rows: 2 });

  const editor = useEditor({
    extensions: buildNoteRichTextExtensions({ imageNode: NoteImageResizable }),
    content: props.initialBody,
  });
  const fmt =
    useEditorState({ editor, selector: (s) => formatOf(s.editor) }) ??
    EMPTY_FORMAT;

  // 只在新建态抢焦点；编辑态交给标题的 autoFocus。
  useEffect(() => {
    if (editor && !props.initialBody.trim()) editor.commands.focus("end");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

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

  /** 显式保存（按钮 / Ctrl+Enter）：默认保存并关闭。 */
  async function save(options?: NoteSaveOptions): Promise<void> {
    const body = editorMarkdown(editor, props.initialBody);
    const trimmed = title.trim();
    if (!trimmed && !body) {
      props.onCancel();
      return;
    }
    // 缺工作区时展开任务面板，不静默失败。
    if (taskWorkspaceMissing) {
      setTaskDetailOpen(true);
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
          agentPreset,
          ...(selectedModel !== undefined ? { model: selectedModel } : {}),
          ...(schedule !== undefined ? { schedule } : {}),
        },
        options,
      );
    } finally {
      setSaving(false);
    }
  }

  /* ---------- 自动保存 / Ctrl+S ---------- */

  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSavedAt = useRef<number | null>(null);
  const autoSaver = useRef<AutoSaver | null>(null);
  /** 在途标记：撞上在途保存就跳过，不并发。 */
  const autoSaving = useRef(false);
  /** 落盘基线签名：自动保存与关闭前的改动判定共用。 */
  const savedSignature = useRef<string | null>(null);
  /** 草稿镜像：保存回调异步执行，闭包里的 state 是排定时那刻的旧值。 */
  const draftRef = useRef({ title, color, taskOn, taskStatus, workspace, agentPreset, modelValue, schedule });
  useEffect(() => {
    draftRef.current = { title, color, taskOn, taskStatus, workspace, agentPreset, modelValue, schedule };
  });

  /** 存库字段全集：正文从编辑器现取，其余取草稿镜像。 */
  function draftFields(overrides?: { title?: string; body?: string }): NoteDraftFields {
    const draft = draftRef.current;
    return {
      title: overrides?.title ?? draft.title,
      body: overrides?.body ?? editorMarkdown(editor, props.initialBody),
      color: draft.color,
      taskOn: draft.taskOn,
      taskStatus: draft.taskStatus,
      workspace: draft.workspace,
      agentPreset: draft.agentPreset,
      modelValue: draft.modelValue,
      schedule: draft.schedule,
    };
  }

  /**
   * 基线编辑器就绪后从编辑器里读，不拿 props 拼：
   * Markdown 往返会规范化，用 props 当基线一打开就会被判成有改动。
   */
  useEffect(() => {
    if (!editor || savedSignature.current !== null) return;
    savedSignature.current = noteDraftSignature(draftFields());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  /**
   * 落盘一次但不关弹窗、不置 saving（标题框 disabled 会丢焦点）。
   * 空标题跳过（可能正在删标题），force（Ctrl+S）才补默认标题。
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
    // 缺工作区的任务不落盘，等工作区选好后 markDirty 重排。
    if (draft.taskOn && draft.workspace.trim() === "") {
      setAutoSaveState("idle");
      return;
    }
    const body = editorMarkdown(editor, props.initialBody);
    const signature = noteDraftSignature(draftFields({ title: nextTitle, body }));
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
          agentPreset: draft.agentPreset,
          ...(parseModelKey(draft.modelValue) !== undefined
            ? { model: parseModelKey(draft.modelValue) as NoteModelSelection }
            : {}),
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

  function markDirty(): void {
    if (props.autoSave !== true) return;
    setAutoSaveState((state) => (state === "saved" || state === "error" ? "idle" : state));
    autoSaver.current?.touch();
  }

  // save 走 ref：否则会闭包到首帧 editor 还是 null 的那版 autoSaveNow。
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

  // tiptap 只在文档真变化时发 update（焦点/选区不算）。
  useEffect(() => {
    if (!editor || props.autoSave !== true) return;
    const onUpdate = (): void => markDirty();
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, props.autoSave]);

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

  /* ---------- 关闭闸 ---------- */

  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  /** 关闭请求（X / 「取消」）：有改动先弹确认，没改动直接关。 */
  function requestClose(): void {
    if (saving) return;
    if (!isNoteDraftDirty(savedSignature.current, draftFields())) {
      props.onCancel();
      return;
    }
    setCloseConfirmOpen(true);
  }

  /** Esc 的层级：先收弹层，再落到关闭闸。 */
  function requestEscapeClose(): void {
    if (popup !== null) {
      closePopup();
      return;
    }
    requestClose();
  }

  function saveAndClose(): void {
    setCloseConfirmOpen(false);
    void save();
  }

  function discardAndClose(): void {
    setCloseConfirmOpen(false);
    props.onCancel();
  }

  function keepEditing(): void {
    setCloseConfirmOpen(false);
  }

  // 每次渲染把最新的关闭闸填进外层 ref（遮罩点击按 Esc 那条，先收弹层）。
  useEffect(() => {
    const target = props.requestCloseRef;
    if (!target) return;
    target.current = requestEscapeClose;
    return () => {
      target.current = null;
    };
  });

  function run(fn: (e: Editor) => void): void {
    if (editor) fn(editor);
  }

  function closePopup(): void {
    setPopup(null);
  }

  /** 捕获阶段监听 pointerdown；触发按钮（data-fs-tool-pop）豁免。 */
  useEffect(() => {
    if (!popup) return;
    const onPointerDown = (event: PointerEvent): void => {
      const el = event.target;
      if (!(el instanceof Element)) return;
      if (el.closest("[data-dsh-part=\"note-pop\"], [data-fs-tool-pop]")) return;
      closePopup();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup]);

  /* ---------- 链接 ---------- */

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

  function normalizeUrl(raw: string): string {
    const value = raw.trim();
    if (!value) return "";
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
    return `https://${value}`;
  }

  function applyLink(): void {
    if (!editor) return;
    const url = normalizeUrl(linkDraft.url);
    const text = linkDraft.text.trim();
    const { empty } = editor.state.selection;
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      closePopup();
      return;
    }
    if (!empty) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    } else if (text) {
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
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    closePopup();
  }

  function unlinkAtSelection(): void {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    closePopup();
  }

  /** Enter 应用；Esc 只关弹层（stopPropagation 挡整卡取消）。 */
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

  const codeLangKnown = CODE_LANGUAGES.some((o) => o.value === fmt.codeLang);
  const selectLang = fmt.codeLang && codeLangKnown ? fmt.codeLang : "";
  const unknownLang = fmt.codeLang && !codeLangKnown ? fmt.codeLang : null;

  function setCodeLanguage(lang: string): void {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .updateAttributes("codeBlock", { language: lang || null })
      .run();
  }


  return {
    autoSaveNow,
    save,
    title,
    setTitle,
    color,
    setColor,
    colorMeta,
    taskOn,
    setTaskOn,
    taskStatus,
    setTaskStatus,
    workspace,
    setWorkspace,
    agentPreset,
    setAgentPreset,
    modelValue,
    setModelValue,
    modelOptionGroups,
    presetOptions,
    taskDetailOpen,
    setTaskDetailOpen,
    taskSummaryText,
    taskWorkspaceMissing,
    schedule,
    setSchedule,
    scheduleConfirm,
    setScheduleConfirm,
    intervalUnit,
    setIntervalUnit,
    intervalAmount,
    scheduleNextText,
    scheduleSummaryTitle,
    workspaceOptions,
    workspacePlaceholder,
    workspaceSelectTitle,
    runningReadOnly,
    saving,
    runExpanded,
    setRunExpanded,
    scheduleDetailOpen,
    setScheduleDetailOpen,
    popup,
    linkDraft,
    setLinkDraft,
    gridSize,
    setGridSize,
    editor,
    fmt,
    lastSavedAt,
    autoSaver,
    markDirty,
    autoSaveHintText,
    closeConfirmOpen,
    requestClose,
    requestEscapeClose,
    saveAndClose,
    discardAndClose,
    keepEditing,
    run,
    closePopup,
    openLinkPopup,
    applyLink,
    unlinkAtSelection,
    linkFieldKeyDown,
    toggleTablePopup,
    insertTableGrid,
    tableOp,
    selectLang,
    unknownLang,
    setCodeLanguage,
  }
}
