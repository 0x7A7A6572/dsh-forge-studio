/**
 * 便签编辑器的全部状态与动作（NoteEditor 的逻辑面）。
 *
 * 视图（components/NoteEditor.tsx）只解构返回值 + 画 JSX，自己不碰 tiptap 实例、
 * 不碰自动保存调度、不注册任何 window 监听 —— 想知道「Ctrl+S 会发生什么」，看这里。
 *
 * 与视图的接口就一个平铺对象：视图同名解构，JSX 与拆分前一字不差。
 *
 * 关闭只有一道闸：所有关闭入口（X / 「取消」/ Esc / 点遮罩）都汇到 requestClose（Esc
 * 与遮罩先走 requestEscapeClose 收弹层，再落到同一条闸）—— 有改动先问「保存并关闭 /
 * 放弃改动 / 继续编辑」，没改动直接关。少接一条路径，用户刚写的内容就会被静默丢掉
 * （新建便签尤其致命：它没有库记录）。
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
 * `on` = 是否任务便签；`status` = 泳道状态；`workspace` = 执行工作区（空串 = 未指定，
 * 而任务必须有工作区 —— 编辑器侧挡在保存按钮上，host 侧挡成 missing-workspace）；
 * `agentPreset` = 执行会话的 agent 预设（空串 = 宿主默认）；
 * `model` = 执行模型（undefined = 宿主默认）；
 * `schedule` = 定时日程草稿（undefined = 不定时；已停用的日程仍带 enabled:false 对象）。
 */
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
   * 里跑的事」，执行时以该目录新建会话。**必填** —— M1-4 起不再有默认工作区，
   * 任务没工作区就执行不了，编辑器也不允许这样保存。
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
  /** 工作区候选（最近会话用过的 cwd；下拉只选不手填，选项标签只给文件夹名）。 */
  readonly workspaceOptions?: readonly string[];
  /**
   * 工作区候选是否已加载完成。未就绪时占位项不写「（无候选）」——那是「还没数据」，
   * 不是「没有候选」，写了它就会在候选到达的一瞬间被替换（提示一闪而过）。
   */
  readonly workspaceReady?: boolean;
  /**
   * 任务执行目标目录（模型 / agent 预设，M2）：空目录 = 只有「宿主默认」可选
   * （宿主没装会话控制器 / 预设服务时就是这情形）。
   */
  readonly taskTargets?: TaskTargets;
  /** 编辑既有便签时开启：停顿后自动保存（不关弹窗）。新建态恒 false。 */
  readonly autoSave?: boolean;
  /**
   * 关闭请求出口：编辑器自己的关闭入口（X / 「取消」/ Esc）走内部关闭闸（有改动先问一句）。
   * 但遮罩点击属于 EditorPageDialog 的 DOM、快捷浮层与板子的兜底 Esc 更是连 DOM 都不在
   * 编辑器里，那几条路也得走同一道闸，否则「点外面 / 按 Esc」就能绕过确认直接丢改动 ——
   * 所以由它们把这个 ref 交下来，编辑器每次渲染把最新的关闭闸填进去；卸下时清空，
   * 外层拿不到时退回它自己的直接关。
   */
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
   * 任务执行工作区：编辑态带出便签值，新建态留空。留空 = 不落字段，且**执行会被拒**
   * （M1-4：没有默认工作区兜底）—— 所以留空时不允许把便签设成/存成任务。
   */
  const [workspace, setWorkspace] = useState(props.initialWorkspace ?? "");
  /**
   * 任务执行目标（M2）：agent 预设（空串 = 宿主默认）与模型（'' = 宿主默认）。
   * 存的是 select 的 value（模型用 modelKey 编码），落库前经 parseModelKey 还原。
   */
  const [agentPreset, setAgentPreset] = useState(props.initialLane?.agentPreset ?? "");
  const [modelValue, setModelValue] = useState(() => modelKey(props.initialLane?.model));
  const selectedModel = parseModelKey(modelValue);
  /**
   * 模型下拉的分组选项：目录 + 「当前值不在目录里」的兜底项（见 modelSelectGroups）。
   * 依赖 modelValue 而不只是目录：用户换选后旧值不必继续占位。
   */
  const modelOptionGroups = useMemo(
    () => modelSelectGroups(props.taskTargets?.models ?? [], selectedModel),
    [props.taskTargets, modelValue],
  );
  /**
   * agent 预设下拉选项：同样给「当前值不在目录里」兜底，免得旧预设被静默抹掉。
   */
  const presetOptions = useMemo(() => {
    const list = [...(props.taskTargets?.presets ?? [])];
    const chosen = agentPreset.trim();
    if (chosen !== "" && !list.some((entry) => entry.id === chosen)) {
      list.push({ id: chosen, name: chosen + "（不在当前目录）" });
    }
    return list;
  }, [props.taskTargets, agentPreset]);
  /**
   * 任务详情（折纸面板）是否展开：M2-1 起便签纸里默认只留一行摘要，点开才折出
   * 工作区/状态/定时/模型/预设/执行记录。两种入口默认展开：
   * - 列头「＋新建任务」（initialLaneStatus）：来的目的就是配任务，不该再让用户多点一次；
   * - 已有执行记录的任务（done/failed）：折起来的是**设置**，执行结果是内容 ——
   *   打开一张已完成的任务却要先点一下才看得到 AI 写了什么，那是把内容也藏了。
   */
  const [taskDetailOpen, setTaskDetailOpen] = useState(
    props.initialLaneStatus !== undefined
    || props.initialLane?.status === "done"
    || props.initialLane?.status === "failed",
  );
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
  /** 空选择项的占位文案（候选未就绪时不说「无候选」，那是「还没数据」）。 */
  const workspacePlaceholder = props.workspaceReady === false ? "选择工作区…" : "选择工作区（无候选）";
  const workspaceSelectTitle = workspace !== "" ? `工作区：${workspace}` : "尚未指定工作区";
  /**
   * 任务缺工作区：任务便签却没有工作区 → 不合法。挡两处：保存按钮禁用 + 摘要行红字，
   * 折叠着就自动展开（问题必须可见，不能藏在折下来的纸里）。
   */
  const taskWorkspaceMissing = taskOn && workspace.trim() === "";
  /** 模型下拉里当前值的显示名（找不到就退回 model id）。 */
  const modelLabel = useMemo(() => {
    for (const group of modelOptionGroups) {
      const hit = group.options.find((option) => option.key === modelValue);
      if (hit !== undefined) return hit.label;
    }
    return selectedModel?.model ?? "";
  }, [modelOptionGroups, modelValue, selectedModel]);
  /** 预设下拉里当前值的显示名（找不到就退回 id）。 */
  const presetLabel =
    agentPreset.trim() === ""
      ? ""
      : (presetOptions.find((entry) => entry.id === agentPreset.trim())?.name ?? agentPreset.trim());
  /**
   * 折起来那一行摘要：[状态 · 工作区 · 模型 · 预设]，缺的项直接省略（只写「宿主默认」
   * 反而占地方）。工作区缺失时写红字提示 —— 折叠不等于把问题藏起来。
   */
  const taskSummaryParts = [
    laneLabel(taskStatus),
    workspace.trim() === "" ? "未选工作区" : folderNameOf(workspace),
    modelLabel === "" ? "" : modelLabel,
    presetLabel === "" ? "" : "预设 " + presetLabel,
  ].filter((part) => part !== "");
  const taskSummaryText = taskSummaryParts.join(" · ");
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
    // 任务必须有工作区（M1-4）：没选就落不了库，直接展开折纸面板把问题摆到眼前，
    // 不要「点了保存却什么都没发生」。
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

  /* ---------- 自动保存 / Ctrl+S（编辑既有便签，落盘但不关弹窗） ---------- */

  /** 自动保存指示灯（只在真落盘时变化，打字过程不刷状态）。 */
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  /** 最近一次落盘时刻（只做 title 悬停提示）。 */
  const lastSavedAt = useRef<number | null>(null);
  /** 自动保存调度器（防抖/在途补跑/取消，见 core/auto-save.ts）。 */
  const autoSaver = useRef<AutoSaver | null>(null);
  /** 在途标记：Ctrl+S 与调度器撞上时不并发（撞上就跳过，等在途那次落盘）。 */
  const autoSaving = useRef(false);
  /**
   * 上次落盘（编辑态）或刚打开时（新建态）的草稿签名 —— 两处共用：
   * - 自动保存：草稿没变就不重复写库/广播；
   * - 关闭前：判「有没有改动」，决定关之前要不要问一句（见 core/note-draft-diff.ts）。
   */
  const savedSignature = useRef<string | null>(null);
  /**
   * 最新草稿镜像（标题/纸色/任务开关/状态/工作区）：自动保存回调异步执行，闭包里
   * 的 state 是排定时那一刻的旧值，故用 ref 取「保存时」的真值。
   */
  const draftRef = useRef({ title, color, taskOn, taskStatus, workspace, agentPreset, modelValue, schedule });
  useEffect(() => {
    draftRef.current = { title, color, taskOn, taskStatus, workspace, agentPreset, modelValue, schedule };
  });

  /**
   * 当前草稿字段（存库字段的全集）：正文从编辑器现取，其余取草稿镜像。
   * 自动保存与「改动判定」共用同一份字段表 —— 两边各写一份，早晚会漏字段。
   */
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
   * 基线只取一次，且**编辑器就绪后从编辑器里读**（不是拿 props 拼）：
   * Markdown → 编辑器文档 → Markdown 的往返会做规范化（列表缩进、表格对齐…），
   * 用 props.initialBody 当基线的话，一打开就被判成「有改动」，关闭时白弹一次。
   */
  useEffect(() => {
    if (!editor || savedSignature.current !== null) return;
    savedSignature.current = noteDraftSignature(draftFields());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

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
    // 任务缺工作区时不落盘：把半配好的任务写进库，用户回头只会看到一张执行不了的
    // 便签。指示灯留在原地（摘要行已有红字），工作区一选好 markDirty 会重新排。
    if (draft.taskOn && draft.workspace.trim() === "") {
      setAutoSaveState("idle");
      return;
    }
    const body = editorMarkdown(editor, props.initialBody);
    // 签名与「改动判定」共用一份字段表（core/note-draft-diff.ts）：自动保存跳过重复写入
    // 的判据，和关闭前问不问的判据必须是同一个，否则会出现「关了不提示但其实没存」。
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

  /* ---------- 关闭闸：有改动先问一句 ---------- */

  /**
   * 「便签有改动」确认弹窗是否打开。关闭是不可逆的丢弃动作，所以先落到弹窗上，
   * 由用户明确选「保存并关闭 / 放弃改动 / 继续编辑」。
   */
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  /**
   * 关闭请求（X / 「取消」）：有改动 → 弹确认；没改动 → 直接关。
   * 全部关闭入口都必须走这里 —— 少一条，那条路就成了静默丢内容的暗门。
   */
  function requestClose(): void {
    if (saving) return;
    if (!isNoteDraftDirty(savedSignature.current, draftFields())) {
      props.onCancel();
      return;
    }
    setCloseConfirmOpen(true);
  }

  /**
   * Esc 的关闭请求：弹层（链接 / 表格）开着就先收弹层 —— Esc 的层级是「弹层 → 关闭闸」，
   * 别让一次 Esc 把弹层和整张便签一起问。
   * 编辑器、遮罩点击、快捷浮层的 Esc、板子的兜底 Esc 都走这条，层级才不会各按各的。
   */
  function requestEscapeClose(): void {
    if (popup !== null) {
      closePopup();
      return;
    }
    requestClose();
  }

  /** 确认弹窗「保存并关闭」：交给显式保存（空草稿/缺工作区的拦截与关弹窗都在 save 里）。 */
  function saveAndClose(): void {
    setCloseConfirmOpen(false);
    void save();
  }

  /** 确认弹窗「放弃改动」：明确授权的丢弃，不动库，直接关（新建态即不创建）。 */
  function discardAndClose(): void {
    setCloseConfirmOpen(false);
    props.onCancel();
  }

  /** 确认弹窗「继续编辑」：只收起确认层，回到编辑器（Esc / 点遮罩也是它）。 */
  function keepEditing(): void {
    setCloseConfirmOpen(false);
  }

  // 遮罩点击（弹窗 DOM 属于 EditorPageDialog）也要走同一条闸：每次渲染把最新的
  // requestEscapeClose 填进它交下来的 ref，卸载时清空（清空后遮罩点击退回直接关）。
  // 填 Esc 那条而不是按钮那条：遮罩点击与 Esc 同属「离开编辑器」的隐式动作，都要先收弹层。
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
