/**
 * 看板卡片：中性底 + 纸色斜向渐变角（note.color），状态由所在列表达。
 * chips 是截止 / 定时 / 工作区；底色与文字全走 --dsw-* 令牌，纸色只做识别。
 */

import { useEffect, useState } from 'react'
import type { NoteRecord } from '../../types.ts'
import { noteColorMeta } from '../core/note-colors.ts'
import { isRunOpen } from '../core/task-lanes.ts'
import { firstImageUrl, mdSnippet, mdToPlainText } from '../core/markdown-text.ts'
import { folderNameOf } from '../core/workspace-path.ts'
import { t } from '../core/theme-tokens.ts'
import { fmtDueChip, dueTone, fromDateInputValue, toDateInputValue } from '../core/due-date.ts'
import { isScheduleBlockedStatus, scheduleBlockTextFor, scheduleLabel } from '../../schedule.ts'
import { fmtCountdown, fmtDateTime, fmtElapsed, fmtRelative, fmtShortDateTime } from '../core/time-text.ts'
import { PinnedCornerMark } from './PinnedCornerMark.tsx'
import { NoteThumbnail } from './NoteThumbnail.tsx'
import {
  Archive,
  CalendarDays,
  Clock,
  Folder,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Undo2,
} from 'lucide-react'
import styles from '../styles/notes-board.module.css'

/** 超过该耗时（30min）running 卡弱提示「执行可能已中断」。 */
const INTERRUPT_AFTER_MS = 30 * 60 * 1000

/** 缺工作区的卡显红字并禁掉执行：一张永远跑不起来的卡不该长得跟正常卡一样。 */

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
  /** 设置截止日期；undefined = 清除。 */
  readonly onSetDue: (dueAt: number | undefined) => void
  /** 定时 chip 点击：切换启停（编辑器里才有完整配置）。 */
  readonly onToggleSchedule: () => void
}

/** 截止 chips 的语义色：逾期红、今明橙、其余次要色。 */
function dueColor(note: NoteRecord): string {
  if (note.dueAt === undefined) return t.labelTertiary
  const tone = dueTone(note.dueAt)
  if (tone === 'overdue') return t.danger
  if (tone === 'soon') return t.stateWarn
  return t.labelSecondary
}

export function TaskLaneCard(props: TaskLaneCardProps): JSX.Element {
  const { note } = props
  // 拖拽不可用/忙时禁用：避免执行中的更新与后续拖放竞争。
  const draggable = !props.busy && !note.archived
  const meta = noteColorMeta(note.color)
  const folded = note.pinned && !note.archived
  const snippet = note.text ? mdSnippet(note.text, 100) : ''
  const thumb = note.text ? firstImageUrl(note.text) : null
  const [dragging, setDragging] = useState(false)
  const [dueOpen, setDueOpen] = useState(false)

  const hasWorkspace = note.workspace !== undefined && note.workspace.trim() !== ''
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

  /** 写截止日期后收起输入；空值 = 清除。 */
  const commitDue = (value: string): void => {
    if (value === '') props.onSetDue(undefined)
    else {
      const ts = fromDateInputValue(value)
      if (ts !== undefined) props.onSetDue(ts)
    }
    setDueOpen(false)
  }

  const stop = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    action()
  }

  return (
    <li
      className={styles.laneWrap}
      style={{
        position: 'relative',
        ...(folded ? { filter: 'drop-shadow(0 2px 10px rgba(0, 0, 0, 0.1))' } : {}),
      }}
    >
      <div
        className={`${styles.laneCard} ${running ? styles.laneRunning : ''}`}
        role="button"
        tabIndex={0}
        aria-label={note.title || '无标题'}
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
          backgroundImage: `linear-gradient(327deg, ${meta.ring}, transparent 20%)`,
          opacity: dragging ? 0.45 : 1,
          ...(folded
            ? {
              borderTopRightRadius: 0,
              boxShadow: 'none',
              clipPath: 'polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%)',
            }
            : {}),
        }}
      >
        <span
          className={styles.laneTitle}
          style={{
            ...cardTitle,
            ...(folded ? { paddingRight: 12 } : {}),
          }}
          title={note.title || '（无标题）'}
        >
          {note.title || '（无标题）'}
        </span>

        {thumb && <NoteThumbnail src={thumb} maxHeight={80} />}

        {snippet ? (
          <span className={styles.laneSnippet} style={cardSnippet}>
            {snippet}
          </span>
        ) : null}

        {running ? (
          <>
            <span style={metaRow}>
              <span className={styles.laneSpinner} style={spinner} aria-hidden="true" />
              <span style={{ color: t.labelSecondary }}>
                {run?.by === 'schedule' ? '定时触发 · ' : ''}已执行 {fmtElapsed(elapsedMs)}
              </span>
            </span>
            {interrupted && (
              <span style={{ ...metaRow, color: t.labelTertiary }}>执行可能已中断，可重置</span>
            )}
          </>
        ) : summary ? (
          <span className={styles.laneSummary} style={cardSnippet} title={run?.summary}>
            {summary}
          </span>
        ) : null}

        {dueOpen ? (
          <span style={metaRow} onClick={(e) => e.stopPropagation()}>
            <input
              type="date"
              autoFocus
              className={styles.dueInput}
              style={dueInputStyle}
              defaultValue={note.dueAt !== undefined ? toDateInputValue(note.dueAt) : ''}
              onChange={(e) => commitDue(e.target.value)}
              onBlur={() => setDueOpen(false)}
            />
          </span>
        ) : (
          <span style={chipsRow}>
            <button
              type="button"
              className={styles.chip}
              style={{ ...chipStyle, color: dueColor(note), cursor: 'pointer' }}
              title={note.dueAt !== undefined ? `截止 ${fmtDateTime(note.dueAt)}` : '设置截止日期（进日历）'}
              onClick={stop(() => setDueOpen(true))}
            >
              <CalendarDays size={10} aria-hidden="true" />
              {note.dueAt !== undefined ? fmtDueChip(note.dueAt) : '＋ 截止'}
            </button>            {note.schedule !== undefined && (
              <button
                type="button"
                className={styles.chip}
                style={{ ...chipStyle, cursor: 'pointer' }}
                disabled={props.busy}
                title={
                  '定时：' + scheduleLabel(note.schedule) +
                  (note.schedule.enabled && note.schedule.nextAt > 0
                    ? ' · 下次 ' + fmtDateTime(note.schedule.nextAt) + '（' + fmtCountdown(note.schedule.nextAt) + '）'
                    : ' · 已暂停') +
                  (note.schedule.endAt !== undefined ? ' · 有效期至 ' + fmtDateTime(note.schedule.endAt) : '') +
                  (note.schedule.lastResult !== undefined ? ' · 上次 ' + note.schedule.lastResult : '') +
                  (note.schedule.enabled && isScheduleBlockedStatus(note.lane?.status)
                    ? ' · ' + (scheduleBlockTextFor(note.lane?.status) ?? '') + '（拖回「待办」即恢复）'
                    : '') +
                  ' · 点击' + (note.schedule.enabled ? '暂停' : '恢复')
                }
                onClick={stop(props.onToggleSchedule)}
              >
                <Clock size={10} aria-hidden="true" />
                {note.schedule.enabled
                  ? isScheduleBlockedStatus(note.lane?.status)
                    ? '定时待命'
                    : note.schedule.nextAt > 0
                      ? fmtShortDateTime(note.schedule.nextAt)
                      : scheduleLabel(note.schedule)
                  : '已暂停'}
              </button>
            )}
            {hasWorkspace ? (
              <span style={chipStyle} title={`工作区：${note.workspace}`}>
                <Folder size={10} aria-hidden="true" />
                <span style={chipText}>{folderNameOf(note.workspace ?? '')}</span>
              </span>
            ) : rerun ? null : (
              <span style={warnMeta} title="任务必须有工作区：打开这张便签，在「设为任务」里选一个再执行">
                <Folder size={10} aria-hidden="true" />
                未设工作区
              </span>
            )}
            {(note.schedule?.failureStreak ?? 0) > 0 && (
              <span style={{ ...warnMeta, gap: 2 }}>失败 {note.schedule?.failureStreak ?? 0}</span>
            )}
          </span>
        )}

        <span style={footerRow}>
          <time style={timeStyle} title={fmtDateTime(note.updatedAt)}>{fmtRelative(note.updatedAt)}</time>
          <span className={styles.laneActions} style={actionsStyle}>
            {running ? (
              <button type="button" title="重置为待办" aria-label="重置为待办" disabled={props.busy}
                onClick={stop(props.onReset)} style={actionBtn}>
                <Undo2 size={12} />
              </button>
            ) : (
              <button type="button" aria-label={rerun ? '重跑' : '执行'} disabled={props.busy || !hasWorkspace}
                title={hasWorkspace
                  ? (rerun ? '重跑' : '执行')
                  : '任务必须有工作区：打开这张便签，在「设为任务」里选一个再执行'}
                onClick={stop(props.onExecute)} style={actionBtn}>
                {rerun ? <RefreshCw size={12} /> : <Play size={12} />}
              </button>
            )}
            <button type="button" title="编辑" aria-label="编辑" disabled={props.busy}
              onClick={stop(props.onEdit)} style={actionBtn}>
              <Pencil size={12} />
            </button>
            <button type="button" title="归档" aria-label="归档" disabled={props.busy}
              onClick={stop(props.onToggleArchive)} style={actionBtn}>
              <Archive size={12} />
            </button>
            <button type="button" title="删除" aria-label="删除" data-danger disabled={props.busy}
              onClick={stop(props.onRemove)} style={actionBtn}>
              <Trash2 size={12} />
            </button>
          </span>
        </span>
      </div>
      {!note.archived && (
        <PinnedCornerMark
          pinned={note.pinned}
          color={meta.ring}
          size={14}
          onToggle={props.onTogglePin}
        />
      )}
    </li>
  )
}

/* ---------- 样式（几何 + 令牌；hover/动效在 notes-board.module.css） ---------- */

const cardStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  position: 'relative',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  minHeight: 64,
  padding: '9px 10px 7px 12px',
  borderRadius: 18,
  borderWidth: 1,
  cursor: 'pointer',
  color: t.labelPrimary,
}
const cardTitle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  lineHeight: 1.45,
  color: t.labelPrimary,
}
const cardSnippet: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.5,
  color: t.labelTertiary,
  wordBreak: 'break-word',
}
const chipsRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
  minWidth: 0,
}
const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  maxWidth: '100%',
  height: 18,
  padding: '0 5px',
  boxSizing: 'border-box',
  border: 'none',
  borderRadius: 5,
  fontSize: 10.5,
  lineHeight: 1,
  color: t.labelSecondary,
}
const chipText: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
/** 行内警告（不占 chip 底色）：每张卡都挂红块太吵，缺工作区只要看得见就够。 */
const warnMeta: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 10.5,
  lineHeight: 1,
  color: t.danger,
}
const metaRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  minWidth: 0,
  fontSize: 11,
  lineHeight: 1.4,
  color: t.labelSecondary,
}
const dueInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '3px 4px',
  border: `1px solid ${t.borderL2}`,
  borderRadius: 6,
  background: 'transparent',
  color: t.labelPrimary,
  fontSize: 11.5,
}
const spinner: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  flex: 'none',
}
const footerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 4,
  minHeight: 18,
}
const timeStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: t.labelTertiary,
}
const actionsStyle: React.CSSProperties = {
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
  height: 18,
  padding: 0,
  border: 'none',
  borderRadius: 5,
  color: t.labelSecondary,
  cursor: 'pointer',
}
