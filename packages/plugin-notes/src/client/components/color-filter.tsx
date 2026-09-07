/**
 * 颜色筛选条（列表/纸卡共用）：NOTE_COLOR_PALETTE 按钮行，多选 toggle。
 * - aria-pressed 表示该色是否在筛选中；全部未选 = 不过滤（显示全部颜色）；
 * - 有任一选中时出现「全部」复位按钮。
 * 展示形式与编辑器底部色板一致：纸色小块 + 选中描边（ring）。
 */

import type { NoteColor } from '../../types.ts'
import { NOTE_COLOR_PALETTE } from '../core/note-colors.ts'
import { t } from '../core/theme-tokens.ts'

/** 色块 hover/focus 态；ring 选中描边与淡化过渡。 */
export const FILTER_CSS = `
.fs-note-filter-chip { transition: transform 120ms ease, box-shadow 160ms ease, opacity 140ms ease; }
.fs-note-filter-chip:hover:not(:disabled) { transform: scale(1.12); }
.fs-note-filter-chip:focus-visible { outline: 2px solid var(--dsw-static-deepseek-450); outline-offset: 1px; }
`

export interface ColorFilterProps {
  /** 当前选中的颜色；空数组 = 不过滤。 */
  readonly colors: readonly NoteColor[]
  readonly onToggle: (color: NoteColor) => void
  /** 复位为全部。 */
  readonly onClear: () => void
}

export function ColorFilter(props: ColorFilterProps): JSX.Element {
  const { colors } = props
  return (
    <div role="group" aria-label="按颜色筛选便签" style={filterStyle}>
      {NOTE_COLOR_PALETTE.map((c) => {
        const active = colors.includes(c.id)
        const dimmed = colors.length > 0 && !active
        return (
          <button
            key={c.id}
            type="button"
            className="fs-note-filter-chip"
            title={`${c.label}色便签${active ? '（筛选中）' : ''}`}
            aria-label={`${active ? '取消' : '按'}${c.label}色筛选`}
            aria-pressed={active}
            onClick={() => props.onToggle(c.id)}
            style={{
              ...chipStyle,
              background: c.paper,
              ...(active ? { boxShadow: `0 0 0 2px ${c.ring}`, transform: 'scale(1.06)' } : {}),
              ...(dimmed ? { opacity: 0.4 } : {}),
            }}
          />
        )
      })}
      {colors.length > 0 && (
        <button type="button" style={allBtn} onClick={props.onClear}>
          全部
        </button>
      )}
    </div>
  )
}

/* ---------- 样式 ---------- */

const filterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}
const chipStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 5,
  cursor: 'pointer',
}
const allBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 8px',
  border: 'none',
  borderRadius: 10,
  fontSize: 12,
  color: t.labelSecondary,
  background: t.hoverBg,
  cursor: 'pointer',
}
