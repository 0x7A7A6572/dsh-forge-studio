/**
 * 侧栏计费入口的**主题契约** —— 只提供数据接口，不提供画法。
 *
 * 主题 = `$DSH_HOME/themes/usage-billing/<id>/index.tsx` 里的一个文件。
 * 它拿一份 {@link ThemeProps}，把宿主外壳里面的像素全部画完。
 *
 * ## 宿主保留什么
 *
 * 1. **壳**：那个 `<button>`、`aria-expanded` / 无障碍名、popup 的锚点与开关；
 * 2. **数据**：判档结果 + 已格式化的展示数据（见 {@link ThemeProps}）；
 * 3. **时钟**：`data.minute` 由宿主每分钟推进一次并重新渲染主题。
 *
 * popup 里那张大图**不在契约内**，仍是 usage-billing 自己的实现。
 *
 * ## 为什么判档必须由契约给
 *
 * 画法被推翻过三次（M 型曲线 → 双轨 → 24h 环），而
 * `{ workday, peakWindows, minute } → tone` 这条路径一个字都没改过。
 * 易变的是画法，稳定的是数据。所以 {@link toneAtMinute} 放在契约里，
 * **主题不要自己再判一遍** —— 判两遍就有分叉的可能，而「此刻是峰还是谷」
 * 是这张卡唯一的功能职责（美观自由，这个不自由）。
 *
 * ## 刻意不在契约里（别"顺手"加）
 *
 * - **价格与倍率**：主题只需要"此刻贵不贵"；
 * - **几何**：几何正是要被替换的东西；
 * - **回调与 ref**：主题拿不到 `toggle` / `anchorRef`，于是这是一份纯展示数据。
 */
import type { ComponentType } from 'react'

/**
 * 契约子路径的模块名。
 *
 * 它是主题源码里的 import 目标，也是 `THEME_ALLOWED_MODULES` 的最后一项；
 * 运行时由 `hooks/theme-runtime.ts` 把它映射回本模块的实例 ——
 * 于是主题里的 `toneAtMinute` 与宿主用的是**同一个函数**。
 */
export const SHAPE_SPECIFIER = '@zzerx/dsh-plugin-usage-billing/shape'

/** 档位。与宿主判档同口径，不是"曲线的高低"。 */
export type TierTone = 'peak' | 'offPeak'

/**
 * 高峰时段表：每项是 `[起点, 终点)`，单位是**规则时区当日的分钟**（0..1440）。
 * 左闭右开 —— 09:00 是高峰，12:00 不是，与宿主逐分钟一致。
 */
export type PeakWindows = readonly (readonly [number, number])[]

/** 判档结果。主题不必、也无法知道这些数字是怎么算出来的。 */
export interface TierShapeData {
  /** 规则时区下的自然日是不是工作日。非工作日时 `peakWindows` 必为空。 */
  readonly workday: boolean
  /** 高峰时段。空数组 = 一整天都是空闲价。 */
  readonly peakWindows: PeakWindows
  /**
   * 此刻：规则时区当日的分钟，0..1439。
   * 宿主每分钟更新一次并重新渲染主题 —— 主题**不要**自己再开时钟，
   * 否则一处走一处停，「现在」就不唯一了。
   */
  readonly minute: number
  /** 此刻的档位。宿主已经判好了，直接读。 */
  readonly tone: TierTone
}

/** 进度条已用段里的一段构成。 */
export interface TierEntryBand {
  /** 哪一段。会话 / 本项目 / 今日 —— 主题按 key 上色（色板在宿主的外壳上）。 */
  readonly key: 'session' | 'workspace' | 'today'
  /** 占**已用段**的比例（不是占预算），0..1。 */
  readonly ratio: number
}

/** 预算进度。`null` = 没设预算口径，主题不该画进度条。 */
export interface TierEntryProgress {
  /** 已用 / 上限。**可能大于 1**（超支），要能画得下溢出。 */
  readonly ratio: number
  /** 档位：ok 正常 / warn 接近上限 / over 已超。 */
  readonly level: 'ok' | 'warn' | 'over'
  /** 已用金额，已格式化（含货币符号）。 */
  readonly spentText: string
  /** 预算上限，已格式化。 */
  readonly limitText: string
  /**
   * 已用段内部的构成，**绘制顺序**。空数组 = 没有构成可画（只有一个整段）。
   * 给的是比例而不是原始金额：主题要的是「这一段画多长」，不是账目本身。
   */
  readonly bands: readonly TierEntryBand[]
}

/**
 * 展示数据：除了判档之外，侧栏入口要显示的东西。
 *
 * 全部**已格式化** —— 金额该用的千分位、货币符号、缩写口径都由宿主决定
 * （这是计费的口径，不该由每个主题各写一份）。主题只负责摆。
 */
export interface TierEntryView {
  /**
   * 侧栏是不是宽态。`false` = 收成了 36px 的 rail，
   * 那种宽度下除了一个饼图什么都放不下 —— 主题必须自己处理这个退化尺寸。
   */
  readonly wide: boolean
  /** 本月已用金额。 */
  readonly monthText: string
  /** 今日已用金额。 */
  readonly todayText: string
  /** 数据读取失败：主题应当把这件事说出来（宿主不再叠一个"读取失败"角标）。 */
  readonly failed: boolean
  /** 无定价口径时的提示文案；`null` = 一切正常。措辞由宿主给，主题决定怎么显示。 */
  readonly unpricedText: string | null
  /**
   * 用户的「显示峰谷时段图」偏好（设置页那个开关）。**可选遵从** ——
   * 主题愿意听就听，想一直画也行；它只是偏好，不是契约约束。
   */
  readonly showTier: boolean
  /** 预算进度；`null` = 没设预算。 */
  readonly progress: TierEntryProgress | null
}

/** 主题组件拿到的**全部**输入。纯数据：没有回调，没有 ref，没有 children。 */
export interface ThemeProps {
  /**
   * 判档结果。`null` = **没有分时价口径**（规则还没生效 / 旧宿主不下发这个字段）。
   *
   * 这时画不出峰谷，主题应当只画金额与进度 —— 而**不是**编一个工作日模板出来：
   * 写死一条平坦的曲线，用户会以为今天真的全天一个价。
   */
  readonly data: TierShapeData | null
  /** 展示数据。 */
  readonly view: TierEntryView
}

/**
 * 一个主题。
 *
 * `id` 就是它在磁盘上的目录名（`themes/usage-billing/<id>/`），由扫盘决定，
 * 主题源码里不重复声明 —— 声明两处就有对不上的可能。
 */
export interface Theme {
  /** 主题 id = 目录名。 */
  readonly id: string
  /** 设置页下拉里显示的名字。 */
  readonly label: string
  /** 画这块区域的组件。必须填满宿主给的空间，不要在意外层尺寸。 */
  readonly component: ComponentType<ThemeProps>
}

/**
 * 内置主题的 id。
 *
 * 内置那张卡**留在 client bundle 里**（它要用宿主内部零件与 CSS Modules），
 * 走的是同一个 `Theme` 接口，只是不从磁盘来。用户在设置里选了不存在的主题时，
 * 宿主回落到它。
 */
export const BUILTIN_THEME_ID = 'builtin'

/**
 * 主题允许 import 的**全部**裸模块。
 *
 * 这是主题 ABI 的一部分：转译期的 guard 插件按它放行，client 的 require 表按它提供
 * 实例。清单**故意是平台模块表的一个子集**（`react-dom` / `@deepseek-ai/cordis`
 * 这些主题用不上，不放进来的代价只是主题 require 时会拿到明确报错）。
 *
 * `scripts/theme-contract.spec.ts` 钉两条：清单 ⊆ 平台模块表 + 契约子路径；
 * 且宿主 require 表覆盖清单全部。
 */
export const THEME_ALLOWED_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
  SHAPE_SPECIFIER,
]

/**
 * 判档：这一分钟是高峰价还是空闲价。**窗口左闭右开。**
 *
 * 契约里唯一一个"业务"函数，也是主题不该自己实现的那个 —— 它必须与宿主逐分钟一致，
 * 否则卡片上那个圆点和宿主收的钱会悄悄错开一分钟。
 *
 * 直接遍历宿主下发的原始窗口，不做规范化（不夹取、不排序、不去重）：
 * 少一层加工，就少一处可能与宿主分叉的地方。
 */
export function toneAtMinute(peakWindows: PeakWindows, minute: number): TierTone {
  for (const [from, to] of peakWindows) {
    if (minute >= from && minute < to) return 'peak'
  }
  return 'offPeak'
}

/** 规则时区当日分钟 → `HH:MM`。1440 会得到 `24:00`，那是"一天的右端点"，不是合法时刻。 */
export function clockText(minute: number): string {
  const hour = Math.floor(minute / 60)
  return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}
