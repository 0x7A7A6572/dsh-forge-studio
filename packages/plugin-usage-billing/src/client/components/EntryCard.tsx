/**
 * 侧栏入口（slot: sidebar.footer.action）—— **宿主只保留外壳**。
 *
 * 壳里三件事，一件也不多：
 * 1. 一个撑满侧栏给的空间的 `<button>`：整卡是一个可点击区，`aria-expanded` 与无障碍名在这；
 * 2. popup 的锚点（`seat.anchorRef`）与挂载点；
 * 3. `.palette` 那组 CSS 变量（`--ub-peak` / `--ub-used` / …），形状想用就用。
 *
 * **卡里画什么由形状决定**：注册表里选中的那个组件被渲染进来（见 core/entry-shape.ts 与
 * shapes/builtin-entry.tsx）。所以这个文件里没有任何版式、颜色或进度条几何 ——
 * 那些全在形状里。找不到选中的形状时回落到内置那条，注册表里永远有内置，不会白屏。
 *
 * 两件事刻意留在宿主：
 * - **时钟**。`useRuleMinute` 在这里读一次，通过 `data.minute` 注入形状。
 *   形状各开一个时钟就会「一处走一处停」，「现在」不唯一。
 * - **判档**。`toneAtMinute`（契约里那份唯一实现）也在这里调，形状直接读结果。
 *
 * 与改动前的一处可见差异：mini 峰谷图原来在按钮**外面**（点它不弹 popup），
 * 现在整卡都在按钮里，点图也会弹 —— 整块可点是「整块由形状画」的必然结果。
 */
import type { ThemeRegistry } from '../core/tier-shape-registry.ts'
import { RULE_UTC_OFFSET_MINUTES } from '../../pricing/tiers.ts'
import { selectTierShape, tierShapePropsOf } from '../core/entry-shape.ts'
import type { BillingScope } from '../core/config.ts'
import { useEntryCard } from '../hooks/useEntryCard.ts'
import type { EntryDataProps } from '../hooks/useEntryCard.ts'
import { useShowTierCurve, useTierShapeId, useEntryVisible } from '../hooks/useEntryFlags.ts'
import { useRuleMinute } from '../hooks/useRuleMinute.ts'
import { useTierShapes } from '../hooks/useTierShapes.ts'
import { BillingPopover } from './BillingPopover.tsx'
import styles from '../styles/settings-section.module.css'

export interface EntryCardProps extends EntryDataProps {
  /** ownerProps：sidebar 是否为宽态（false = 36px rail）。 */
  wide: boolean
  scope: BillingScope
  /** 主题集合（宿主内部那张表，`apply` 注入）。 */
  shapes: ThemeRegistry
}

export function EntryCard(props: EntryCardProps): JSX.Element | null {
  const { wide, scope, shapes } = props
  const card = useEntryCard(props)
  const visible = useEntryVisible(scope, 'sidebar')
  const showTier = useShowTierCurve(scope)
  const shapeId = useTierShapeId(scope)
  // 时钟在宿主走一次：没有分时价口径时退到规则时区的固定偏移（形状这时也不画峰谷）。
  const minute = useRuleMinute(card.tierDay?.utcOffsetMinutes ?? RULE_UTC_OFFSET_MINUTES)
  const registered = useTierShapes(shapes)
  // 挂钩子必须在早退之前（React 的调用顺序约束），所以 visible 的早退排在这里。
  if (!visible) return null

  const shape = selectTierShape(registered, shapeId)
  const Shape = shape?.component
  const shapeProps = tierShapePropsOf({
    tierDay: card.tierDay,
    minute,
    wide,
    monthText: card.amountText,
    todayText: card.todayText,
    failed: card.failed,
    unpricedText: card.unpricedText,
    showTier,
    budget: card.budgetBar,
    segments: card.segments,
  })

  return (
    <span className={styles.entryRow + ' ' + styles.palette} ref={card.seat.anchorRef}>
      <button
        type="button"
        data-dsh-usage-billing
        data-dsh-ub-entry
        data-wide={String(wide)}
        data-dsh-ub-state={card.load}
        // 哪个形状在画这张卡：出问题时先看这里，比翻设置快。
        data-dsh-ub-shape={shape?.id ?? ''}
        className={styles.entryShell}
        title={card.failed ? '计费：数据读取失败（点击重试）' : '计费'}
        aria-label={card.ariaLabel}
        aria-expanded={card.seat.open}
        onClick={card.seat.toggle}
      >
        {Shape === undefined ? null : <Shape {...shapeProps} />}
      </button>
      <BillingPopover
        seat={card.seat}
        headlineText={card.headlineText}
        totalSegments={card.totalSegments}
        todaySegments={card.todaySegments}
        unpricedText={card.unpricedText}
        tierDay={card.tierDay}
        showTierCurve={showTier}
        budget={card.popoverBudget}
      />
    </span>
  )
}
