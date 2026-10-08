/** 主题契约：只给数据，不给画法。主题源文件在 `$DSH_HOME/themes/usage-billing/<id>/index.tsx`。 */
import type { ComponentType } from 'react'

/** 契约子路径。宿主映射回本模块，主题与宿主共用同一个判档函数。 */
export const SHAPE_SPECIFIER = '@zzerx/dsh-plugin-usage-billing/shape'

/** 档位，非视觉样式。 */
export type TierTone = 'peak' | 'offPeak'

/** 每项 `[起点, 终点)`，规则时区当日分钟（0..1440），左闭右开。 */
export type PeakWindows = readonly (readonly [number, number])[]

export interface TierShapeData {
  /** 规则时区当日是不是工作日。非工作日时 `peakWindows` 为空。 */
  readonly workday: boolean
  /** 空数组 = 一整天都是空闲价。 */
  readonly peakWindows: PeakWindows
  /** 规则时区当日分钟 0..1439，由宿主推进。 */
  readonly minute: number
  /** 此刻档位，已判好。 */
  readonly tone: TierTone
}

export interface TierEntryBand {
  /** 色板随外壳给，按 key 取。 */
  readonly key: 'session' | 'workspace' | 'today'
  /** 占已用段的比例，不是占预算，0..1。 */
  readonly ratio: number
}

/** `null` = 没设预算。 */
export interface TierEntryProgress {
  /** 已用 / 上限，可能大于 1（超支）。 */
  readonly ratio: number
  /** 正常 / 接近上限 / 已超。 */
  readonly level: 'ok' | 'warn' | 'over'
  readonly spentText: string
  readonly limitText: string
  /** 按绘制顺序。空数组 = 只有一个整段。 */
  readonly bands: readonly TierEntryBand[]
}

/** 金额已格式化。 */
export interface TierEntryView {
  /** `false` = 收成 36px rail。 */
  readonly wide: boolean
  readonly monthText: string
  readonly todayText: string
  /** 读取失败，由主题呈现。 */
  readonly failed: boolean
  /** `null` = 正常。文案已由宿主写好。 */
  readonly unpricedText: string | null
  /** 显示峰谷图的偏好，可选遵从。 */
  readonly showTier: boolean
  readonly progress: TierEntryProgress | null
}

export interface ThemeProps {
  /** `null` = 没有分时价口径。 */
  readonly data: TierShapeData | null
  readonly view: TierEntryView
}

/** `id` = 磁盘目录名，不要重复声明。 */
export interface Theme {
  readonly id: string
  readonly label: string
  /** 要填满宿主给的空间。 */
  readonly component: ComponentType<ThemeProps>
}

/** 用户选了不存在的主题时回落到它。 */
export const BUILTIN_THEME_ID = 'builtin'

/** 主题允许 import 的裸模块。由 `scripts/theme-contract.spec.ts` 钉住。 */
export const THEME_ALLOWED_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
  SHAPE_SPECIFIER,
]

/**
 * 判档，窗口左闭右开，与宿主逐分钟一致。
 * 不做夹取、排序、去重。
 */
export function toneAtMinute(peakWindows: PeakWindows, minute: number): TierTone {
  for (const [from, to] of peakWindows) {
    if (minute >= from && minute < to) return 'peak'
  }
  return 'offPeak'
}

/** 1440 得到 `24:00`，是右端点不是合法时刻。 */
export function clockText(minute: number): string {
  const hour = Math.floor(minute / 60)
  return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}
