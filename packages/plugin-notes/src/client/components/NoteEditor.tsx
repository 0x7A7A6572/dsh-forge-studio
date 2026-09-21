/**
 * 便签编辑器（tiptap + Markdown）：标题输入 + 富文本正文 + 格式操作栏 + 任务/定时区。
 *
 * 本文件只有编排与 JSX：状态、tiptap 装配、自动保存、弹层与快捷键全在
 * hooks/useNoteEditor.ts；执行记录零件在 components/NoteRunBlock.tsx；操作栏按钮在
 * components/NoteToolButton.tsx。
 *
 * - 正文经 tiptap-markdown 序列化保存为真实 Markdown（不再丢格式）；
 * - 操作栏：粗体/斜体/删除线/标题H1-H3/无序·有序列表/任务清单(todolist)/引用/
 *   行内代码/代码块（+ 语言选择；多行选区一次并成一块，见 core/note-code-block.ts）/
 *   分隔线/链接（弹层设置）/表格（插入·行列操作）/撤销/重做；
 * - 代码块语言高亮、链接与表格能力来自共享扩展层 core/note-richtext.ts；
 * - 粘贴图片：剪贴板图片文件 → data URL 内联插入正文（守卫在 core/note-paste-guard.ts）；
 * - 保存：编辑既有便签时**停顿约 1 秒自动保存**（不关弹窗、不打断输入），
 *   Ctrl/Cmd+S 立即保存；Ctrl/Cmd+Enter 与「保存」按钮仍是「保存并关闭」；
 * - 快捷键：Esc 关闭弹层或取消，Ctrl/Cmd+K 插入链接，Ctrl/Cmd+S 保存不关闭。
 * 父组件用 key 控制实例重建（新建/每条便签各一个编辑器），初值即草稿内容。
 */

import { EditorContent } from "@tiptap/react"
import { SCHEDULE_MODES } from "../../types.ts"
import type { ScheduleMode, TaskStatus } from "../../types.ts"
import {
  SCHEDULE_MAX_FAILURES,
  SCHEDULE_RUN_TIMEOUT_MS,
  fromLocalDateTimeInput,
  makeSchedule,
  previewNextAt,
  scheduleBlockTextFor,
  scheduleLabel,
  toLocalDateTimeInput,
} from "../../schedule.ts"
import { ConfirmDialog } from "./ConfirmDialog.tsx"
import { NOTE_COLOR_PALETTE, NOTE_INK, NOTE_INK_MUTED } from "../core/note-colors.ts"
import { TASK_LANES, laneLabel } from "../core/task-lanes.ts"
import { fmtDateTime } from "../core/time-text.ts"
import { t } from "../core/theme-tokens.ts"
import { CODE_LANGUAGES, codeLanguageLabel } from "../core/code-languages.ts"
import { toggleNoteCodeBlock } from "../core/note-code-block.ts"
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
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
} from "lucide-react"
import { useNoteEditor } from "../hooks/useNoteEditor.ts"
import type { NoteEditorProps } from "../hooks/useNoteEditor.ts"
import { LaneRunBlock } from "./NoteRunBlock.tsx"
import { ToolButton, ToolDivider } from "./NoteToolButton.tsx"
import styles from "../styles/notes-editor.module.css"

export type { NoteEditorProps, NoteSaveOptions, NoteTaskDraft } from "../hooks/useNoteEditor.ts"

/** 定时周期下拉的中文标签（与 SCHEDULE_MODES 一一对应）。 */
const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  once: "一次性",
  interval: "间隔",
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
};

/** 纸面深色淡染（hover / 选中底）。 */
const PAPER_DEEP_TINT = "rgba(46, 42, 34, 0.06)";
/** 纸面浅色填充（输入框底 / 标记底）。 */
const PAPER_SOFT_FILL = "rgba(46, 42, 34, 0.1)";

/** 星期几短标签（0=周日；与 Date#getDay 对齐）。 */
const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 便签编辑器视图：只做编排与 JSX，逻辑全在 useNoteEditor。 */
export function NoteEditor(props: NoteEditorProps): JSX.Element {
  const {
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
    save,
    autoSaveNow,
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
  } = useNoteEditor(props)

  return (
    <div
      data-dsh-part="note-editor" className={`${styles.editor} ${styles.paper}`}
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
      
      {/* 头部行：便签标题直接放在 header（可编辑），省去单独的「新建便签」标题行 */}
      <div style={headRowStyle}>
        <input
          className={styles.title}
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
          onClick={() => run(toggleNoteCodeBlock)}
        >
          <CodeXml size={16} />
        </ToolButton>
        {fmt.codeBlock && (
          <select
            className={styles.langSelect}
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
            <div className={styles.pop} role="dialog" aria-label="插入链接">
              <p className={styles.popTitle}>链接（Ctrl+K）</p>
              <input
                className={styles.field}
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
                className={styles.field}
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
              <div className={styles.popRow}>
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
            <div className={styles.pop} role="dialog" aria-label="表格">
              {fmt.inTable ? (
                <>
                  <p className={styles.popTitle}>表格操作</p>
                  <button
                    type="button"
                    className={styles.popItem}
                    onClick={() => tableOp("addRowBefore")}
                  >
                    <ArrowUpToLine size={14} />
                    在上方插入行
                  </button>
                  <button
                    type="button"
                    className={styles.popItem}
                    onClick={() => tableOp("addRowAfter")}
                  >
                    <ArrowDownToLine size={14} />
                    在下方插入行
                  </button>
                  <button
                    type="button"
                    className={styles.popItem}
                    onClick={() => tableOp("addColumnBefore")}
                  >
                    <ArrowLeftToLine size={14} />
                    在左侧插入列
                  </button>
                  <button
                    type="button"
                    className={styles.popItem}
                    onClick={() => tableOp("addColumnAfter")}
                  >
                    <ArrowRightToLine size={14} />
                    在右侧插入列
                  </button>
                  <button
                    type="button"
                    className={styles.popItem}
                    onClick={() => tableOp("deleteRow")}
                  >
                    <Trash2 size={14} />
                    删除当前行
                  </button>
                  <button
                    type="button"
                    className={styles.popItem}
                    onClick={() => tableOp("deleteColumn")}
                  >
                    <Trash2 size={14} />
                    删除当前列
                  </button>
                  <button
                    type="button"
                    className={styles.popItem}
                    onClick={() => tableOp("deleteTable")}
                  >
                    <Trash2 size={14} />
                    删除整个表格
                  </button>
                </>
              ) : (
                <>
                  <p className={styles.popTitle}>
                    插入表格：{gridSize.cols} 列 × {gridSize.rows} 行
                  </p>
                  <div
                    className={styles.popGrid}
                    onMouseLeave={() => setGridSize({ cols: 3, rows: 2 })}
                  >
                    {Array.from({ length: 6 }, (_, row) => (
                      <div className={styles.popGridRow} key={row}>
                        {Array.from({ length: 6 }, (_, col) => (
                          <button
                            key={col}
                            type="button"
                            className={`${styles.popGridCell}${
                              col < gridSize.cols && row < gridSize.rows
                                ? ` ${styles.on}`
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
                {/* 定时摘要行：只回答「下次什么时候」。闸门徽章与失败红字仍露在这一行上
                    （异常必须可见），上次结果 / 共跑次数 / 运行记录 / 说明收进「详情」。 */}
                <span style={scheduleMeta} title={scheduleSummaryTitle}>
                  <Clock size={11} aria-hidden="true" />
                  {scheduleNextText}
                </span>
                {schedule.enabled && scheduleBlockTextFor(taskStatus) !== undefined && (
                  <span
                    style={scheduleStatusChip}
                    title={(scheduleBlockTextFor(taskStatus) ?? "") + "——拖回「待办」即恢复"}
                  >
                    {laneLabel(taskStatus)} · 不执行
                  </span>
                )}
                {(schedule.failureStreak ?? 0) > 0 && (
                  <span
                    style={scheduleWarn}
                    title={
                      "连续失败 " + (schedule.failureStreak ?? 0) + " 次" +
                      ((schedule.failureStreak ?? 0) >= SCHEDULE_MAX_FAILURES
                        ? "（已达上限，日程已停用）"
                        : `（满 ${SCHEDULE_MAX_FAILURES} 次自动停用）`)
                    }
                  >
                    连续失败 {schedule.failureStreak ?? 0} 次
                  </span>
                )}
                <button
                  type="button"
                  className={styles.runToggle}
                  onClick={() => setScheduleDetailOpen((v) => !v)}
                  aria-expanded={scheduleDetailOpen}
                  title={scheduleDetailOpen ? "收起详情" : "展开详情"}
                >
                  {scheduleDetailOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  详情
                </button>
              </>
            )}
            {/* 详情（默认收起）：上次结果 / 共跑次数 / 运行记录 / 一句后果说明。 */}
            {schedule !== undefined && scheduleDetailOpen && (
              <div style={scheduleDetail}>
                <span style={scheduleDetailRow}>
                  上次：{schedule.lastResult ?? "还没跑过"}
                  {(schedule.runCount ?? 0) > 0 ? " · 共跑 " + schedule.runCount + " 次" : ""}
                </span>
                {props.initialLane?.run !== undefined && (
                  <LaneRunBlock
                    run={props.initialLane.run}
                    expanded={runExpanded}
                    onToggle={() => setRunExpanded((v) => !v)}
                  />
                )}
                <span style={scheduleDetailNote}>
                  到点自动帮你跑一次，跟你手动点「执行」一样；便签板关着也照跑。
                  卡片停在『待规划 / 已完成 / 已失败』时不会跑，拖回『待办』就恢复。
                </span>
              </div>
            )}
          </div>
        )}
        {/* 非定时卡片：执行记录原地展示（定时卡片已收进上面的「详情」）。 */}
        {taskOn &&
          schedule === undefined &&
          props.initialLane !== undefined &&
          props.initialLane.run !== undefined && (
            <LaneRunBlock
              run={props.initialLane.run}
              expanded={runExpanded}
              onToggle={() => setRunExpanded((v) => !v)}
            />
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
            className={styles.color}
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
          className={styles.btn}
          style={btnGhost}
          disabled={saving}
          onClick={props.onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
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
          description="到点自动帮你跑一次，跟你手动点「执行」一样；便签板关着也照跑。"
          accent={colorMeta.ring}
          bullets={[
            `周期：${scheduleLabel(scheduleConfirm)}${
              (() => {
                const next = previewNextAt(scheduleConfirm);
                return next !== undefined ? `，下次 ${fmtDateTime(next)}` : "（保存后按当前时刻计算）";
              })()
            }`,
            `工作区：${workspace.trim() !== "" ? workspace : defaultWorkspaceOptionLabel}`,
            "卡片停在『待规划 / 已完成 / 已失败』时不会跑，拖回『待办』就恢复",
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

/* ---------- 样式 ---------- */

const laneRunMuted: React.CSSProperties = {
  fontSize: 12.5,
  color: "rgba(46, 42, 34, 0.45)",
};

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
/** 状态闸门徽章（当前列不自动执行）：浅底胶囊，比红字弱、比摘要小字显眼。 */
const scheduleStatusChip: React.CSSProperties = {
  padding: "1px 6px",
  fontSize: 11,
  lineHeight: 1.6,
  color: "rgba(46, 42, 34, 0.72)",
  background: PAPER_SOFT_FILL,
  borderRadius: 6,
  whiteSpace: "nowrap",
};
/** 「详情」面板：整行独占（flex 1 1 100%），收起时完全不占版面。 */
const scheduleDetail: React.CSSProperties = {
  flex: "1 1 100%",
  display: "flex",
  flexDirection: "column",
  gap: 5,
  padding: "6px 8px",
  background: PAPER_SOFT_FILL,
  borderRadius: 8,
};
/** 详情里的「上次 / 共跑」一行。 */
const scheduleDetailRow: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.5,
  color: NOTE_INK_MUTED,
};
/** 详情里的一句后果说明（原是常驻的整行提示，收进详情后不再占版面）。 */
const scheduleDetailNote: React.CSSProperties = {
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
/** 定时摘要行尾的「下次时刻 · 倒计时」小字（弱化，别抢正文视线）。 */
const scheduleMeta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11.5,
  color: NOTE_INK_MUTED,
  flex: "1 1 160px",
  minWidth: 0,
};
/** 执行记录区：开始/结束/结果一行（· 分隔）+ 摘要。 */
/** run.summary 只读 markdown 的内层排版覆盖（嵌套在编辑器内，见 RunSummaryMarkdown）。 */
/** 执行结果文字：成功绿 / 失败红（语义色令牌，明暗主题自适应）。 */
