/**
 * 把取数结果装配成形状要的那份数据 —— 契约与宿主内部数据结构之间的**唯一**转换点。
 *
 * 之所以单独成一个纯函数（不塞进 hook）：它是「宿主的数据 → 形状的数据」这条边界，
 * 边界要能被单测直接钉住（见 scripts/entry-shape.spec.ts），而不是只能靠渲染一个组件去观察。
 */
import type { TierEntryBand, Theme, ThemeProps } from '../../shape/index.ts'
import { BUILTIN_THEME_ID, toneAtMinute } from '../../shape/index.ts'
import type { TierDayProfile } from '../../pricing/tiers.ts'

/** 契约里的进度条要的宿主数据（`BudgetBarView` 满足它）。 */
export interface ShapeBudget {
  readonly level: 'ok' | 'warn' | 'over'
  readonly ratio: number
  /** 预算上限，已格式化。 */
  readonly monthlyText: string
  /** 本月已用：三段的比例都是拿它当分母。 */
  readonly spentValue: number
}

/** 契约里的进度分段要的宿主数据（`PopoverSegment` 满足它）。 */
export interface ShapeSegment {
  readonly key: string
  readonly value: number | null
}

/** 绘制顺序 = 叠放顺序（后画的在上），与内置形状的注释一致。 */
const BAND_ORDER = ['session', 'workspace', 'today'] as const

/** 一段占「已用段」的比例；未知 / 非正按 0（不画这一段），超过已用则整段。 */
function bandRatio(value: number | null | undefined, spent: number): number {
  if (value === null || value === undefined || !Number.isFinite(value) || spent <= 0) return 0
  return Math.min(Math.max(value, 0) / spent, 1)
}

/** 装配形状数据的全部输入（都由 useEntryCard 给出，除了 minute 与 showTier）。 */
export interface EntryShapeInput {
  readonly tierDay: TierDayProfile | null
  /** 宿主那唯一一个时钟读到的「此刻」。 */
  readonly minute: number
  readonly wide: boolean
  readonly monthText: string
  readonly todayText: string
  readonly failed: boolean
  readonly unpricedText: string | null
  readonly showTier: boolean
  readonly budget: ShapeBudget | null
  readonly segments: readonly ShapeSegment[]
}

/**
 * 组装一份 {@link ThemeProps}。
 *
 * `data` 为 `null` 时（没有分时价口径：规则未生效 / 旧宿主不发这个字段）**不许编一个**
 * —— 写死一个工作日模板等于撒谎，形状宁可只画金额与进度。
 */
export function tierShapePropsOf(input: EntryShapeInput): ThemeProps {
  const { tierDay, minute, budget } = input
  const data = tierDay === null
    ? null
    : {
      workday: tierDay.workday,
      peakWindows: tierDay.peakWindows,
      minute,
      // 判档只有契约那一份实现：宿主这里也不自己遍历窗口。
      tone: toneAtMinute(tierDay.peakWindows, minute),
    }
  const bands: TierEntryBand[] = []
  if (budget !== null) {
    for (const key of BAND_ORDER) {
      const segment = input.segments.find((s) => s.key === key)
      const ratio = bandRatio(segment?.value, budget.spentValue)
      // 比例为 0 的段不画：契约里"空数组 = 没有构成"，与"有一段的长度是 0"是两回事。
      if (ratio > 0) bands.push({ key, ratio })
    }
  }
  return {
    data,
    view: {
      wide: input.wide,
      monthText: input.monthText,
      todayText: input.todayText,
      failed: input.failed,
      unpricedText: input.unpricedText,
      showTier: input.showTier,
      progress: budget === null
        ? null
        : {
          ratio: budget.ratio,
          level: budget.level,
          // 已用就是卡上那个「本月」金额：两者必须同源，否则会出现
          // 「进度条画到 80% 而旁边写着另一个数」。
          spentText: input.monthText,
          limitText: budget.monthlyText,
          bands,
        },
    },
  }
}

/**
 * 挑出要渲染的形状：设置里选的 id 在注册表里找不到时（插件被停用 / 卸载 / 名字改了）
 * 回落到内置那条。注册表里永远有内置，所以**不会白屏**。
 */
export function selectTierShape(shapes: readonly Theme[], id: string): Theme | undefined {
  return shapes.find((shape) => shape.id === id)
    ?? shapes.find((shape) => shape.id === BUILTIN_THEME_ID)
}
