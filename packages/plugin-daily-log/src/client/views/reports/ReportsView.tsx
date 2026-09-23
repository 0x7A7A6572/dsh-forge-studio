/**
 * 工作报告 · 报告页：卡片栅格，展开的那张横跨整行读正文（栅格列宽读长文太窄）。
 */
import { IconBrowseOutlineRegular, IconDownloadOutlineRegular, IconTrashOutlineRegular, MarkdownText, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatDateRange, formatTime } from '../../core/format.ts'
import { IconAction } from '../../components/IconAction.tsx'
import { useReportsView } from './useReportsView.ts'
import type { ReportsViewProps } from './useReportsView.ts'
import styles from '../../styles/settings-section.module.css'

/** MarkdownText 本地化文案（引用稳定常量）。 */
const MD_LABELS = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/** 报告页。 */
export function ReportsView(props: ReportsViewProps): JSX.Element {
  const { openId, toggleOpen, exportReport, removeReport } = useReportsView(props)

  if (props.reports.length === 0) {
    return (
      <div className={styles.pane}>
        <p className={styles.empty}>
          还没有报告。在左侧对话里对 AI 说一句「帮我生成本周周报」，确认正文后报告会存档到这里，并可按需导出 Markdown。
        </p>
      </div>
    )
  }

  return (
    <div className={styles.pane}>
      <h3 className={styles.groupHead}>已生成报告</h3>
      <ul className={styles.cards}>
        {props.reports.map((r) => {
          const open = openId === r.id
          return (
            <li key={r.id} className={open ? styles.card + ' ' + styles.cardWide : styles.card}>
              <div className={styles.cardBody}>
                <div className={styles.cardHead}>
                  <span className={styles.cardName} title={r.title}>{r.title}</span>
                  {r.reportType !== undefined && <Pill>{r.reportType}</Pill>}
                  <span className={styles.chip}>{formatDateRange(r.dateRange.since, r.dateRange.until)}</span>
                </div>
                {open
                  ? (
                    <div className={styles.preview + ' ' + styles.previewTall}>
                      <MarkdownText text={r.markdown} labels={MD_LABELS} />
                    </div>
                  )
                  : <span className={styles.cardDesc}>生成于 {formatTime(r.createdAt)}</span>}
              </div>
              <div className={styles.cardFoot}>
                <IconAction
                  label={open ? '收起正文' : '查看正文'}
                  icon={<IconBrowseOutlineRegular size={16} />}
                  onClick={() => { toggleOpen(r.id) }}
                />
                <IconAction
                  label="导出 Markdown"
                  disabled={props.busy}
                  icon={<IconDownloadOutlineRegular size={16} />}
                  onClick={() => { exportReport(r.id) }}
                />
                <IconAction
                  label="删除报告"
                  danger
                  disabled={props.busy}
                  icon={<IconTrashOutlineRegular size={16} />}
                  onClick={() => { removeReport(r.id) }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
