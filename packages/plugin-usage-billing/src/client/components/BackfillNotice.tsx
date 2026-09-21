/**
 * 回填口径的一次性可关闭提示条（设置页计费分区的顶部）。
 *
 * 版式对齐 plugin-memory：提示条是一张左侧带色条的卡片，操作在右下角用 Button 原语。
 */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatDateTime } from '../core/format.ts'
import styles from '../styles/settings-section.module.css'

export function BackfillNotice(props: {
  installAt: number
  dismissed: boolean
  /**
   * 只读 scope（`settings.writable === false`）下宿主会拒绝写入。
   * 按钮**必须显式门控**（与设置页的开关同一姿态），否则它是一个按了没反应的按钮。
   */
  writable: boolean
  onDismiss(): void
}): JSX.Element | null {
  if (props.dismissed) return null
  return (
    <div className={styles.notice} data-dsh-usage-billing data-dsh-ub-notice data-kind="info" role="status">
      <span>
        安装前的历史用量按<strong>安装时点的价表估算</strong>，可能与实际账单不一致。
        括号里的时刻（{formatDateTime(props.installAt)}）是<strong>本次宿主加载</strong>该服务时
        立下的估算起点，不是当初首次安装的时刻：更早的事件按该次加载的快照估算；本次加载之后
        写入的每一笔都按事件发生时刻的价格锁定，不再变动。
      </span>
      <div className={styles.noticeFoot}>
        <Button variant="ghost" size="sm" disabled={!props.writable} onClick={props.onDismiss} aria-label="不再提示">
          知道了
        </Button>
      </div>
    </div>
  )
}
