/**
 * 常驻口径说明（设置页，**不可关**）。
 *
 * `installAt` 为 `null`（status 未到 / 取数失败 / 命名空间里从未落盘）或非正数时必须渲染
 * 占位：`formatDateTime(0)` 会印出「1970-01-01 08:00」，那是一个看起来像事实的假日期。
 *
 * 这个值的口径是**本次宿主加载**该服务时立下的估算起点（`index.ts` 每次 apply 现取
 * `Date.now()`），不是当初首次安装的时刻：措辞必须如实说明，否则任何一次宿主重启都会让
 * 「安装前」这三个字把更晚写入、其实按事件时刻计价的行也说成估算。
 */
import { NON_FINITE_PLACEHOLDER, formatDateTime } from '../core/format.ts'
import styles from '../styles/settings-section.module.css'

export function BackfillLedgerNote(props: { installAt: number | null; snapshotId: string }): JSX.Element {
  const at = props.installAt !== null && props.installAt > 0
    ? formatDateTime(props.installAt)
    : NON_FINITE_PLACEHOLDER
  return (
    <p className={styles.sub + ' ' + styles.ledgerNote} data-dsh-usage-billing data-dsh-ub-sub>
      计费口径：费用在事件写入账本时按「当时生效的价表快照」计算并锁定，此后调价不影响历史。
      本次加载时刻 {at}，回填所用快照 <code>{props.snapshotId}</code>；
      回填区间在概览、趋势与明细中都标为「估算」。唯一的重算通道是「按当前价表重算未计价历史」，
      它只处理尚未计价的记录。
    </p>
  )
}
