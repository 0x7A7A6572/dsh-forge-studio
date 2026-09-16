/**
 * 回填口径的两种呈现（spec §5.6，用户明确要求「需要提醒用户」）：
 * - BackfillNotice：首次聚合后的一次性可关闭提示条（入口卡与弹窗顶部）
 * - BackfillLedgerNote：设置页常驻、**不可关**的口径说明
 */

import { NON_FINITE_PLACEHOLDER, formatDateTime } from '../core/format.ts'

export function BackfillNotice(props: {
  installAt: number
  dismissed: boolean
  /**
   * 只读 scope（`settings.writable === false`）下宿主会拒绝写入。
   * 按钮**必须显式门控**（与设置页的三个开关同一姿态），否则它是一个按了没反应的按钮。
   */
  writable: boolean
  onDismiss(): void
}): JSX.Element | null {
  if (props.dismissed) return null
  return (
    <div data-dsh-usage-billing data-dsh-ub-notice role="status">
      <span>
        安装前的历史用量按<strong>安装时点的价表估算</strong>，可能与实际账单不一致。
        括号里的时刻（{formatDateTime(props.installAt)}）是<strong>本次宿主加载</strong>该服务时
        立下的估算起点，不是当初首次安装的时刻：更早的事件按该次加载的快照估算；本次加载之后
        写入的每一笔都按事件发生时刻的价格锁定，不再变动。
      </span>
      <button type="button" disabled={!props.writable} onClick={props.onDismiss} aria-label="不再提示">知道了</button>
    </div>
  )
}

/**
 * 常驻口径说明。`installAt` 为 `null`（status 未到 / 取数失败 / 命名空间里从未落盘）
 * 或非正数时必须渲染占位：`formatDateTime(0)` 会印出「1970-01-01 08:00」，那是一个
 * 看起来像事实的假日期（ledger 已有此 ruling；Dashboard 的提示条同样按 `> 0` 门控）。
 *
 * 这个值的口径是**本次宿主加载**该服务时立下的估算起点（`index.ts` 每次 apply 现取
 * `Date.now()`），不是当初首次安装的时刻：措辞必须如实说明，否则任何一次宿主重启都会让
 * 「安装前」这三个字把更晚写入、其实按事件时刻计价的行也说成估算。
 */
export function BackfillLedgerNote(props: { installAt: number | null; snapshotId: string }): JSX.Element {
  const at = props.installAt !== null && props.installAt > 0
    ? formatDateTime(props.installAt)
    : NON_FINITE_PLACEHOLDER
  return (
    <p data-dsh-usage-billing data-dsh-ub-sub>
      计费口径：费用在事件写入账本时按「当时生效的价表快照」计算并锁定，此后调价不影响历史。
      本次加载时刻 {at}，回填所用快照 <code>{props.snapshotId}</code>；
      回填区间在概览、趋势、热力图与明细中都标为「估算」。唯一的重算通道是「按当前价表重算未计价历史」，
      它只处理尚未计价的记录。
    </p>
  )
}
