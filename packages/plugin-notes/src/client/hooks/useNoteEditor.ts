/**
 * 便签编辑器的全部状态与动作（NoteEditor 的逻辑面）。
 *
 * 视图（components/NoteEditor.tsx）只解构返回值 + 画 JSX，自己不碰 tiptap 实例、
 * 不碰自动保存调度、不注册任何 window 监听 —— 想知道「Ctrl+S 会发生什么」，看这里。
 *
 * 与视图的接口就一个平铺对象：视图同名解构，JSX 与拆分前一字不差。
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useEditor, useEditorState } from "@tiptap/react"
import type { Editor } from "@tiptap/core"
import { DEFAULT_NOTE_COLOR } from "../../types.ts"
import type { NoteColor, NoteLane, NoteScheduleInput, TaskStatus } from "../../types.ts"
import { previewNextAt } from "../../schedule.ts"
import { noteColorMeta } from "../core/note-colors.ts"
import { isRunOpen } from "../core/task-lanes.ts"
import { createAutoSaver, type AutoSaver } from "../core/auto-save.ts"
import { fmtCountdown, fmtDateTime, fmtShortDateTime } from "../core/time-text.ts"
import { folderNameOf, workspaceSelectOptions } from "../core/workspace-path.ts"
import { buildNoteRichTextExtensions } from "../core/note-richtext.ts"
import { NoteImageResizable } from "../components/NoteImageResizeView.tsx"
import { CODE_LANGUAGES } from "../core/code-languages.ts"
import { EMPTY_FORMAT, editorMarkdown, formatOf } from "../core/note-format-state.ts"
import { liveEditors, registerPasteGuard } from "../core/note-paste-guard.ts"

/** 自动保存延迟：最后一次改动后静置多久落盘（太短会边打字边写库）。 */
const AUTO_SAVE_DELAY_MS = 1200;
/** 自动保存撞上在途保存时的重试间隔。 */
const AUTO_SAVE_RETRY_MS = 500;

export interface NoteSaveOptions {
  readonly close?: boolean;
  readonly silent?: boolean;
}

/**
 * 任务草稿 patch（编辑器 → 保存链路 → 便签板落库）：
 * `on` = 是否任务便签；`status` = 泳道状态；`workspace` = 执行工作区（空串 = 用默认）；
 * `schedule` = 定时日程草稿（undefined = 不定时；已停用的日程仍带 enabled:false 对象）。
 */
export interface NoteTaskDraft {
  readonly on: boolean;
  readonly status: TaskStatus;
  readonly workspace: string;
  readonly schedule?: NoteScheduleInput;
}

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

/** 编辑器逻辑：状态、tiptap 装配、自动保存、弹层与快捷键都在这里。 */
export function useNoteEditor(props: NoteEditorProps) {
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
   * 定时摘要行只回答「下次什么时候」：停用 / 闸门 / 连续失败各自用徽章或红字露在这一行上
   * （异常必须可见），完整时刻（含年份）进 title。
   */
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
  /** 定时「详情」是否展开（默认收起：上次结果、共跑次数、运行记录、说明都收在里面）。 */
  const [scheduleDetailOpen, setScheduleDetailOpen] = useState(false);

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
      if (el.closest("[data-dsh-part=\"note-pop\"], [data-fs-tool-pop]")) return;
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
    defaultWorkspaceOptionLabel,
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
