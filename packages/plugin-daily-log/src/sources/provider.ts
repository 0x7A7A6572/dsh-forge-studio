/**
 * 渠道 provider 抽象：一个项目路径下的一类活动来源（git 提交 / 各 agent 会话）。
 * probe = 该路径是否命中此渠道（来源徽标 & 是否尝试扫描）；
 * scan = 命中时产出该路径在时间窗内的活动条目（sourceLabel 由调用方统一赋项目名）。
 */

import type { ActivityEntry, DateRange, SourceKind } from '../types.ts'

export interface ChannelProvider {
  readonly kind: SourceKind
  /** 该项目路径是否命中此渠道（轻量探测，供徽标与扫描开关）。 */
  probe(path: string): Promise<boolean>
  /** 扫描该项目路径在时间窗内的活动。 */
  scan(input: { path: string; label: string; range: DateRange; author?: string }): Promise<ActivityEntry[]>
}
