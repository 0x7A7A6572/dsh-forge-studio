/**
 * 日历视图：月网格（周一起始）+ 选中日事项列表。
 * 事项两类：截止（蓝点，`dueAt`）与定时触发（绿点，`schedule.nextAt`）。
 * 点格子选日，点事项进编辑器；月份用 ‹ › 翻，右上「今天」回到当月当日。
 * 布局只有几何在 JSX，hover/选中态在 styles/notes-board.module.css。
 */

import type { NoteRecord } from '../../../../types.ts'
import { fmtMonthDay } from '../../../core/due-date.ts'
import { t } from '../../../core/theme-tokens.ts'
import { useCalendarBoard } from './useCalendarBoard.ts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from '../../../styles/notes-board.module.css'

export interface CalendarBoardProps {
  /** 已做颜色/搜索筛选的活动便签。 */
  readonly notes: readonly NoteRecord[]
  readonly onEdit: (note: NoteRecord) => void
}

const DUE_COLOR = 'var(--dsw-alias-state-business-primary)'
const SCHEDULE_COLOR = 'var(--dsw-alias-state-success-primary)'
const RUN_COLOR = 'var(--dsw-alias-state-warn-primary, var(--dsw-alias-state-warn-label))'

function markerColor(kind: string): string {
  if (kind === 'due') return DUE_COLOR
  if (kind === 'schedule') return SCHEDULE_COLOR
  return RUN_COLOR
}

function eventLabel(kind: string, ok: boolean | undefined): string {
  if (kind === 'due') return '截止'
  if (kind === 'schedule') return '定时'
  return ok === false ? '执行失败' : '执行成功'
}

export function CalendarBoard(props: CalendarBoardProps): JSX.Element {
  const cal = useCalendarBoard({ notes: props.notes, onEdit: props.onEdit })
  const selectedDate = new Date(`${cal.selectedKey}T00:00:00`)

  return (
    <div style={rootStyle}>
      <header style={headStyle}>
        <span style={labelStyle}>{cal.label}</span>
        <span style={countStyle}>{cal.monthEventCount} 天有事项</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={styles.calNavBtn} style={navBtnStyle} title="上一月" aria-label="上一月" onClick={cal.goPrev}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" className={styles.calNavBtn} style={todayBtnStyle} onClick={cal.goToday}>
          今天
        </button>
        <button type="button" className={styles.calNavBtn} style={navBtnStyle} title="下一月" aria-label="下一月" onClick={cal.goNext}>
          <ChevronRight size={15} />
        </button>
      </header>

      <div style={weekRowStyle} aria-hidden="true">
        {cal.weekdays.map((day) => (
          <span key={day} style={weekdayStyle}>
            {day}
          </span>
        ))}
      </div>

      <div style={gridStyle} role="grid" aria-label={`${cal.label}日历`}>
        {cal.cells.map((cell) => {
          const dayEvents = cal.eventsByDay.get(cell.key) ?? []
          const kinds = [...new Set(dayEvents.map((event) => event.kind))]
          const selected = cell.key === cal.selectedKey
          return (
            <button
              key={cell.key}
              type="button"
              role="gridcell"
              aria-selected={selected}
              aria-label={`${fmtMonthDay(cell.ts)}${dayEvents.length > 0 ? `，${dayEvents.length} 项` : ''}`}
              className={[styles.calCell, cell.today ? styles.calCellToday : '', selected ? styles.calCellSelected : ''].join(' ')}
              style={{
                ...cellStyle,
                ...(cell.inMonth ? {} : { opacity: 0.38 }),
                ...(cell.today ? { color: t.labelPrimary } : {}),
              }}
              onClick={() => cal.selectDay(cell.key)}
            >
              <span style={cellDayStyle}>{cell.day}</span>
              <span style={dotsStyle}>
                {kinds.slice(0, 3).map((kind) => (
                  <i
                    key={kind}
                    style={{
                      ...dotStyle,
                      background: markerColor(kind),
                    }}
                  />
                ))}
                {dayEvents.length > 0 && <span style={cellCountStyle}>{dayEvents.length}</span>}
              </span>
            </button>
          )
        })}
      </div>

      <section style={panelStyle} aria-label="当日事项">
        <header style={panelHeadStyle}>
          <span style={{ fontWeight: 500 }}>
            {fmtMonthDay(selectedDate.getTime())} 周{cal.weekdays[(selectedDate.getDay() + 6) % 7]}
          </span>
          <span style={countStyle}>{cal.selectedEvents.length} 项</span>
        </header>
        <ul style={eventListStyle}>
          {cal.selectedEvents.length === 0 ? (
            <li style={emptyStyle}>这天没有事项</li>
          ) : (
            cal.selectedEvents.map((event) => (
              <li key={`${event.note.id}:${event.kind}:${event.at}`}>
                <button
                  type="button"
                  className={styles.calEventRow}
                  style={eventRowStyle}
                  onClick={() => cal.openNote(event.note)}
                >
                  <i
                    style={{
                      ...dotStyle,
                      flex: 'none',
                      background: markerColor(event.kind),
                    }}
                  />
                  <span style={eventKindStyle}>{eventLabel(event.kind, event.ok)}</span>
                  <span style={eventTitleStyle} title={event.note.title}>
                    {event.note.title || '（无标题）'}
                  </span>
                  <span style={eventTimeStyle}>
                    {event.kind === 'due'
                      ? '全天'
                      : new Date(event.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  )
}

/* ---------- 样式（几何 + 令牌；hover/选中态在 notes-board.module.css） ---------- */

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  gap: 8,
}
const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 'none',
}
const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: t.labelPrimary,
}
const countStyle: React.CSSProperties = {
  fontSize: 12,
  color: t.labelTertiary,
}
const navBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: 7,
  color: t.labelSecondary,
  cursor: 'pointer',
}
const todayBtnStyle: React.CSSProperties = {
  ...navBtnStyle,
  width: 'auto',
  padding: '0 10px',
  fontSize: 12,
  color: t.labelPrimary,
  background: t.hoverBg,
}
const weekRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 4,
  flex: 'none',
}
const weekdayStyle: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 11.5,
  color: t.labelTertiary,
  padding: '2px 0',
}
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gridTemplateRows: 'repeat(6, minmax(42px, 1fr))',
  gap: 4,
  flex: 1,
  minHeight: 0,
}
const cellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 2,
  padding: '5px 6px',
  borderRadius: 8,
  color: t.labelSecondary,
  cursor: 'pointer',
  minWidth: 0,
  overflow: 'hidden',
}
const cellDayStyle: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1.2,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
}
const dotsStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  minHeight: 5,
}
const dotStyle: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: 3,
  display: 'inline-block',
}
const cellCountStyle: React.CSSProperties = {
  fontSize: 10,
  lineHeight: '10px',
  color: t.labelTertiary,
  fontVariantNumeric: 'tabular-nums',
}
const panelStyle: React.CSSProperties = {
  flex: 'none',
  maxHeight: 168,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 8,
  borderTop: `1px solid ${t.borderL1}`,
  minHeight: 0,
}
const panelHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12.5,
  color: t.labelPrimary,
  flex: 'none',
}
const eventListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  minHeight: 0,
}
const eventRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  border: 'none',
  borderRadius: 7,
  color: t.labelPrimary,
  fontSize: 12.5,
  textAlign: 'left',
  cursor: 'pointer',
}
const eventKindStyle: React.CSSProperties = {
  flex: 'none',
  fontSize: 11,
  color: t.labelTertiary,
}
const eventTitleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const eventTimeStyle: React.CSSProperties = {
  flex: 'none',
  fontSize: 11.5,
  color: t.labelTertiary,
  fontVariantNumeric: 'tabular-nums',
}
const emptyStyle: React.CSSProperties = {
  padding: '14px 0',
  textAlign: 'center',
  fontSize: 12.5,
  color: t.labelTertiary,
}
