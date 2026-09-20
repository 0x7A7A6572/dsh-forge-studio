/**
 * 待办清单完成度徽章（纸卡墙 grid / 行式列表 list 共用）：正文含 Markdown 待办项
 * （`- [ ]` / `- [x]`，统计见 core/markdown-text.ts 的 todoProgress）时，在标题旁
 * 显示「已勾选/总数」（如 2/5），一眼看出这张便签还剩几件事；全部勾完换成 ✓ 弱化提示。
 *
 * 与 TaskBadge（便签级任务状态，见 core/task-lanes.ts）不是一回事：那只表示便签被
 * 标记成任务、位于泳道哪一列；本徽章只读正文内容，不涉及任何状态机。
 *
 * 形态：墨迹系小胶囊，浮在浅 pastel 纸色上，颜色一律用 NOTE_INK 墨迹族（纸底固定浅，
 * 深字对比恒成立），全部内联样式，无需额外注入 CSS。
 */

import { NOTE_INK, NOTE_INK_MUTED } from '../core/note-colors.ts'

export interface TodoBadgeProps {
  /** 已勾选项数。 */
  readonly done: number
  /** 总项数（含已勾选）。 */
  readonly total: number
}

export function TodoBadge(props: TodoBadgeProps): JSX.Element {
  const allDone = props.total > 0 && props.done >= props.total
  return (
    <span
      role="img"
      aria-label={`待办清单 ${props.done}/${props.total}`}
      title={allDone
        ? `待办清单：${props.total} 项已全部勾选`
        : `待办清单：已勾选 ${props.done} / 共 ${props.total} 项`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        flex: 'none',
        height: 17,
        padding: '0 6px',
        boxSizing: 'border-box',
        borderRadius: 9,
        fontSize: 10.5,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
        color: allDone ? NOTE_INK_MUTED : NOTE_INK,
        background: allDone ? 'rgba(0, 0, 0, 0.055)' : 'rgba(0, 0, 0, 0.085)',
      }}
    >
      {allDone && <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>✓</span>}
      {`${props.done}/${props.total}`}
    </span>
  )
}
