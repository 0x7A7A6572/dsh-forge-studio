/**
 * 回填口径的两种呈现（spec §5.6，用户明确要求「需要提醒用户」）：
 * - BackfillNotice：首次聚合后的一次性可关闭提示条（入口卡与弹窗顶部）
 * - BackfillLedgerNote：设置页常驻、**不可关**的口径说明
 */

import { formatDateTime } from '../core/format.ts'

export function BackfillNotice(props: { installAt: number; dismissed: boolean; onDismiss(): void }): JSX.Element | null {
  if (props.dismissed) return null
  return (
    <div data-dsh-usage-billing data-dsh-ub-notice role="status">
      <span>
        插件安装前（{formatDateTime(props.installAt)}）的历史用量按<strong>安装时点的价表估算</strong>，
        可能与实际账单不一致。安装后的每一笔都按事件发生时刻的价格锁定，不再变动。
      </span>
      <button type="button" onClick={props.onDismiss} aria-label="不再提示">知道了</button>
    </div>
  )
}

export function BackfillLedgerNote(props: { installAt: number; snapshotId: string }): JSX.Element {
  return (
    <p data-dsh-usage-billing data-dsh-ub-sub>
      计费口径：费用在事件写入账本时按「当时生效的价表快照」计算并锁定，此后调价不影响历史。
      安装时刻 {formatDateTime(props.installAt)}，回填所用快照 <code>{props.snapshotId}</code>；
      回填区间在概览、趋势、热力图与明细中都标为「估算」。唯一的重算通道是「按当前价表重算未计价历史」，
      它只处理尚未计价的记录。
    </p>
  )
}
