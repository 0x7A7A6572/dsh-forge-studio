/**
 * 泳道迷你纸卡（任务泳道列内卡片）：窄列专用压缩版便签纸 —— 仍保持
 * 「便签纸」语义（固定 pastel 底 + 深色文字），纸色由 note.color 决定。
 * - 整卡可拖（HTML5 DnD）：dragstart 写入 note.id，拖到目标列即换状态；
 * - hover 动作与 NoteCard 一致：编辑/置顶/归档或恢复/删除（不置顶时归档态
 *   同样只给恢复），并新增任务执行入口：
 *   · 非 running（backlog/todo）主按钮「执行」；done/failed 主按钮「重跑」；
 *   · running（isRunOpen）常驻 spinner + 相对 startedAt 的已耗时（1s 重渲染），
 *     hover 主按钮「重置为待办」；elapsed > 30min 弱提示「执行可能已中断，可重置」。
 * - done/failed 卡摘要区显示 run.summary 首行（单行截断，title 给全文）。
 * - 点击/回车进入编辑器（换纸色即换状态的后备路径，取色器有键盘支持）。
 * 类选择器样式见导出的 LANE_CARD_CSS（由 board-main 统一注入一次 <style>）。
 */

import { useEffect, useState } from 'react'
import type { NoteRecord } from '../../types.ts'
import { NOTE_INK, NOTE_INK_MUTED, noteColorMeta } from '../core/note-colors.ts'
import { isRunOpen } from '../core/task-lanes.ts'
import { mdSnippet, mdToPlainText } from '../core/markdown-text.ts'
import { folderNameOf } from '../core/workspace-path.ts'
import { t } from '../core/theme-tokens.ts'
import { isScheduleBlockedStatus, scheduleBlockTextFor, scheduleLabel } from '../../schedule.ts'
import { fmtCountdown, fmtDateTime, fmtElapsed, fmtRelative, fmtShortDateTime } from '../core/time-text.ts'
import { PinnedCornerMark } from './pin-corner.tsx'
import {
  Archive,
  ArchiveRestore,
  Clock,
  Folder,
  Pencil,
  Pin,
  Play,
  RefreshCw,
  Trash2,
  Undo2,
} from 'lucide-react'

/** 泳道卡 hover/焦点/拖拽态、running 强调、单行摘要截断与 spinner。 */
export const LANE_CARD_CSS = `
.fs-lane-card { transition: box-shadow 140ms ease, transform 140ms ease, opacity 150ms ease; animation: fs-note-in 200ms ease-out backwards; }
.fs-lane-card:hover { box-shadow: 0 8px 18px rgba(0, 0, 0, 0.16); transform: translateY(-1px); }
.fs-lane-card:focus-visible { outline: 2px solid rgba(0, 0, 0, 0.45); outline-offset: 1px; }
.fs-lane-card[draggable='true'] { cursor: grab; }
.fs-lane-card[draggable='true']:active { cursor: grabbing; }
.fs-lane-actions { opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.fs-lane-card:hover .fs-lane-actions, .fs-lane-card:focus-within .fs-lane-actions { opacity: 1; pointer-events: auto; }
.fs-lane-snippet { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.fs-lane-summary { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.fs-lane-card .fs-lane-actions button { color: rgba(46, 42, 34, 0.55); transition: background 110ms ease, color 110ms ease; }
.fs-lane-card .fs-lane-actions button:hover:not(:disabled) { background: rgba(0, 0, 0, 0.1); color: #2e2a22; }
.fs-lane-card .fs-lane-actions button[data-danger]:hover:not(:disabled) { background: rgba(197, 48, 48, 0.18); color: #b3261e; }
@keyframes fs-lane-spin { to { transform: rotate(360deg); } }
.fs-lane-spinner { border: 2px solid rgba(0, 0, 0, 0.12); border-top-color: rgba(46, 42, 34, 0.55); border-radius: 50%; animation: fs-lane-spin 0.8s linear infinite; }
/* running 斜向扫光（光栅扫描）：一道柔光带以约 -18° 倾角从卡片左外斜穿到右外
   （替代原蓝色 inset 状态边框，见组件 JSX —— running 卡不再加
   var(--dsw-alias-state-business-primary) 描边）。
   形态要点：整卡 overflow hidden 收圆角；带子做 skewX 倾斜 + 上下各超伸 30%，
   保证过卡全程覆盖；渐变两端大段透明、峰值柔化（避免硬边「突兀」）；起止点都在
   卡片可视区外，循环无闪跳。::after 盖在内容上但 pointer-events 放行交互。 */
@keyframes fs-lane-diag {
  0% { transform: translateX(-300%) skewX(-18deg); }
  100% { transform: translateX(300%) skewX(-18deg); }
}
.fs-lane-card.fs-lane-running { position: relative; overflow: hidden; }
.fs-lane-card.fs-lane-running::after {
  content: "";
  position: absolute;
  top: -30%;
  bottom: -30%;
  left: 0;
  width: 46%;
  pointer-events: none;
  background: linear-gradient(
    to right,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.14) 24%,
    rgba(255, 255, 255, 0.52) 50%,
    rgba(255, 255, 255, 0.14) 76%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: fs-lane-diag 2.6s cubic-bezier(0.33, 0, 0.67, 1) infinite;
  will-change: transform;
}
`

/** 超过该耗时（30min）running 卡弱提示「执行可能已中断」。 */
const INTERRUPT_AFTER_MS = 30 * 60 * 1000

/**
 * 工作区展示名走共享辅助（core/workspace-path.ts）：窄列放不下完整路径，只显示
 * 末段目录名，完整路径进 title。未指定工作区（note.workspace 缺省）= 执行时用
 * 默认工作区，卡片不显示该行（避免每张卡都挂一条「用默认」，反而更难扫）。
 */

export interface TaskLaneCardProps {
  readonly note: NoteRecord
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onTogglePin: () => void
  readonly onToggleArchive: () => void
  readonly onRemove: () => void
  /** 执行/重跑（非 running 卡主入口）。 */
  readonly onExecute: () => void
  /** 重置为待办（running 卡主入口，手动接管）。 */
  readonly onReset: () => void
}

export function TaskLaneCard(props: TaskLaneCardProps): JSX.Element {
  const { note } = props
  // 拖拽不可用/忙时禁用：避免执行中的更新与后续拖放竞争。
  const draggable = !props.busy && !note.archived
  const meta = noteColorMeta(note.color)
  const snippet = note.text ? mdSnippet(note.text, 100) : ''
  const [dragging, setDragging] = useState(false)

  const lane = note.lane
  const run = lane?.run
  // running = 状态进行中且 run 帧未收尾（与任务进行中判定一致）。
  const running = lane !== undefined && lane.status === 'running' && isRunOpen(lane)
  // done/failed 卡：主按钮语义为「重跑」，摘要区显示 run.summary 首行。
  const rerun = lane !== undefined && (lane.status === 'done' || lane.status === 'failed')
  const summary = rerun && run?.summary ? mdToPlainText(run.summary.split('\n')[0] ?? '') : ''

  // 运行中每秒重渲染一次以推进已耗时；卸载/结束即清理。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const elapsedMs = running ? Math.max(0, now - (run?.startedAt ?? now)) : 0
  const interrupted = running && elapsedMs > INTERRUPT_AFTER_MS

  return (
    <li>
      <div
        className={running ? 'fs-lane-card fs-lane-running' : 'fs-lane-card'}
        role="button"
        tabIndex={0}
        aria-label={note.archived
          ? `已归档：${note.title || '无标题'}`
          : note.pinned
            ? `置顶：${note.title || '无标题'}`
            : note.title || '无标题'}
        draggable={draggable}
        onDragStart={(e) => {
          setDragging(true)
          e.dataTransfer.setData('text/plain', note.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => setDragging(false)}
        onClick={props.onEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            props.onEdit()
          }
        }}
        style={{
          ...cardStyle,
          background: meta.paper,
          opacity: dragging ? 0.45 : 1,
          ...(note.pinned && !note.archived ? { borderTopRightRadius: 0 } : {}),
          ...(running ? { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)' } : {}),
        }}
      >
        {note.pinned && !note.archived && <PinnedCornerMark color={meta.ring} size={10} />}
        <span style={cardTitleRow}>
          <span style={cardTitle} title={note.title || '（无标题）'}>
            {note.title || <span style={{ color: NOTE_INK_MUTED }}>（无标题）</span>}
          </span>
        </span>
        {/* 执行工作区：有显式指定才显示（缺省 = 用设置默认值，见 lane 卡不刷噪声）。 */}
        {note.workspace !== undefined && note.workspace.trim() !== '' && (
          <span style={cardWorkspace} title={`工作区：${note.workspace}`}>
            <Folder size={10} aria-hidden="true" />
            <span style={cardWorkspaceText}>{folderNameOf(note.workspace)}</span>
          </span>
        )}
        {/* 定时日程：只挂一行「下次时刻 · 倒计时」（悬停看周期、上次结果、共跑次数、
            连续失败与闸门原因）。窄列里长文案由 CSS 截断；停用的日程也显示，
            提醒用户它还在卡片上；失败另用红字追加，异常不靠悬停才看得见。 */}
        {note.schedule !== undefined && (
          <span
            style={cardSchedule}
            title={
              '定时：' + scheduleLabel(note.schedule) +
              (note.schedule.enabled && note.schedule.nextAt > 0
                ? ' · 下次 ' + fmtDateTime(note.schedule.nextAt)
                : ' · 已停用') +
              (note.schedule.lastResult !== undefined ? ' · 上次 ' + note.schedule.lastResult : '') +
              ((note.schedule.runCount ?? 0) > 0 ? ' · 共跑 ' + note.schedule.runCount + ' 次' : '') +
              ((note.schedule.failureStreak ?? 0) > 0 ? ' · 连续失败 ' + note.schedule.failureStreak + ' 次' : '') +
              // 状态闸门：当前列不会自动派发（拖回「待办」即恢复），悬停说清楚。
              (note.schedule.enabled && isScheduleBlockedStatus(note.lane?.status)
                ? ' · ' + (scheduleBlockTextFor(note.lane?.status) ?? '') + '（拖回「待办」即恢复）'
                : '')
            }
          >
            <Clock size={10} aria-hidden="true" />
            <span style={cardScheduleText}>
              {note.schedule.enabled
                ? isScheduleBlockedStatus(note.lane?.status)
                  ? '定时待命'
                  : note.schedule.nextAt > 0
                    ? fmtShortDateTime(note.schedule.nextAt) + ' · ' + fmtCountdown(note.schedule.nextAt)
                    : scheduleLabel(note.schedule)
                : '定时已停用'}
            </span>
            {(note.schedule.failureStreak ?? 0) > 0 && (
              <span style={cardScheduleFail}>失败 {note.schedule.failureStreak ?? 0}</span>
            )}
          </span>
        )}
        {running ? (
          <>
            <span className="fs-lane-status" style={laneStatus}>
              <span className="fs-lane-spinner" style={spinner} aria-hidden="true" />
              <span>
                {run?.by === 'schedule' ? '定时触发 · ' : ''}
                已执行 {fmtElapsed(elapsedMs)}
              </span>
            </span>
            {interrupted && (
              <span className="fs-lane-interrupted" style={interruptedStyle} title="执行可能已中断，可重置">
                执行可能已中断，可重置
              </span>
            )}
          </>
        ) : summary ? (
          <span className="fs-lane-summary" style={{ ...cardSnippet, color: NOTE_INK_MUTED }} title={run?.summary}>
            {summary}
          </span>
        ) : snippet ? (
          <span className="fs-lane-snippet" style={{ ...cardSnippet, color: NOTE_INK_MUTED }}>{snippet}</span>
        ) : (
          <span style={{ ...cardSnippet, color: NOTE_INK_MUTED, fontStyle: 'italic' }}>（无正文）</span>
        )}
        <span style={cardFooter}>
          <time style={{ color: NOTE_INK_MUTED, fontSize: 10.5 }} title={fmtDateTime(note.updatedAt)}>{fmtRelative(note.updatedAt)}</time>
          <span className="fs-lane-actions" style={cardActions}>
            {running ? (
              <button type="button" title="重置为待办" aria-label="重置为待办" disabled={props.busy}
                onClick={(e) => { e.stopPropagation(); props.onReset() }} style={actionBtn}>
                <Undo2 size={12} />
              </button>
            ) : (
              <button type="button" title={rerun ? '重跑' : '执行'} aria-label={rerun ? '重跑' : '执行'} disabled={props.busy}
                onClick={(e) => { e.stopPropagation(); props.onExecute() }} style={actionBtn}>
                {rerun ? <RefreshCw size={12} /> : <Play size={12} />}
              </button>
            )}
            <button type="button" title="编辑" aria-label="编辑" disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onEdit() }} style={actionBtn}>
              <Pencil size={12} />
            </button>
            {!note.archived && (
              <button type="button" title={note.pinned ? '取消置顶' : '置顶'} aria-label={note.pinned ? '取消置顶' : '置顶'}
                disabled={props.busy}
                onClick={(e) => { e.stopPropagation(); props.onTogglePin() }}
                style={{ ...actionBtn, ...(note.pinned ? { color: meta.ring } : {}) }}>
                <Pin size={12} />
              </button>
            )}
            <button type="button"
              title={note.archived ? '恢复（取消归档）' : '归档'}
              aria-label={note.archived ? '恢复' : '归档'}
              disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onToggleArchive() }} style={actionBtn}>
              {note.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
            </button>
            <button type="button" title="删除" aria-label="删除" data-danger disabled={props.busy}
              onClick={(e) => { e.stopPropagation(); props.onRemove() }} style={actionBtn}>
              <Trash2 size={12} />
            </button>
          </span>
        </span>
      </div>
    </li>
  )
}

/* ---------- 样式 ---------- */

const cardStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  position: 'relative',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minHeight: 78,
  padding: '8px 10px 7px',
  borderRadius: 10,
  border: '1px solid rgba(0, 0, 0, 0.07)',
  boxShadow: '0 1px 5px rgba(0, 0, 0, 0.07)',
  cursor: 'pointer',
}
const cardTitleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  minWidth: 0,
}
const cardTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12.5,
  fontWeight: 600,
  color: NOTE_INK,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const cardSnippet: React.CSSProperties = {
  flex: 1,
  fontSize: 11.5,
  lineHeight: 1.5,
  wordBreak: 'break-word',
}
/** 工作区行：小号整行截断（完整路径在 title 里），窄列只显示末段目录名。 */
const cardWorkspace: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  fontSize: 10.5,
  lineHeight: 1.4,
  color: 'rgba(46, 42, 34, 0.5)',
}
const cardWorkspaceText: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
/** 定时行：与工作区行同款小号整行截断（日期 + 周期，悬停看全文）。 */
const cardSchedule: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  fontSize: 10.5,
  lineHeight: 1.4,
  color: 'rgba(46, 42, 34, 0.55)',
}
const cardScheduleText: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
/** 定时失败的红色小标：窄列只留次数，原因看悬停（与卡片其它语义色同源）。 */
const cardScheduleFail: React.CSSProperties = {
  flex: 'none',
  color: t.danger,
}
const laneStatus: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11.5,
  color: NOTE_INK_MUTED,
}
const spinner: React.CSSProperties = {
  width: 11,
  height: 11,
  borderRadius: '50%',
  flex: 'none',
}
const interruptedStyle: React.CSSProperties = {
  fontSize: 10.5,
  lineHeight: 1.4,
  color: 'rgba(46, 42, 34, 0.55)',
}
const cardFooter: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 4,
  paddingTop: 1,
}
const cardActions: React.CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1,
}
const actionBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  cursor: 'pointer',
}