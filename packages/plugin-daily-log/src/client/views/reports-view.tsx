/**
 * 工作报告 · 报告页：卡片栅格，展开的那张横跨整行读正文（栅格列宽读长文太窄）。
 */

import { useState } from 'react'
import { IconBrowseOutline16, IconDownloadOutline16, IconTrashOutline16, MarkdownText, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DailyLogRemote } from '../core/remote.ts'
import type { ReportRecord } from '../../types.ts'
import { IconAction, errText, formatTime } from './parts.tsx'

/** MarkdownText 本地化文案（引用稳定常量）。 */
const MD_LABELS = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/** 时间范围显示：`since ~ until`（无 until 时只显示 since）。 */
function rangeText(r: ReportRecord): string {
  return r.dateRange.until === undefined ? r.dateRange.since : r.dateRange.since + ' ~ ' + r.dateRange.until
}

/** 报告页。 */
export function ReportsView(props: {
  dailyLog: DailyLogRemote
  reports: readonly ReportRecord[]
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
}): JSX.Element {
  const [openId, setOpenId] = useState('')

  async function doExport(id: string): Promise<void> {
    await props.run(async () => {
      // 导出目录缺省时由 host 读设置（outputDir → ~/daily-log-reports）；client API 层没有
      // 「可选形参」，缺省位必须显式传 undefined 占位，否则调用期抛 arity 错误。
      const res = await props.dailyLog.exportReport(id as never, undefined)
      if (res.ok) window.alert('已导出：' + res.value)
      else throw new Error(errText(res.error))
    })
  }

  if (props.reports.length === 0) {
    return (
      <div className="dl-pane">
        <p className="dl-empty">
          还没有报告。在左侧对话里对 AI 说一句「帮我生成本周周报」，确认正文后报告会存档到这里，并可按需导出 Markdown。
        </p>
      </div>
    )
  }

  return (
    <div className="dl-pane">
      <h3 className="dl-group-head">已生成报告</h3>
      <ul className="dl-cards">
        {props.reports.map((r) => {
          const open = openId === r.id
          return (
            <li key={r.id} className={open ? 'dl-card dl-card-wide' : 'dl-card'}>
              <div className="dl-card-body">
                <div className="dl-card-head">
                  <span className="dl-card-name" title={r.title}>{r.title}</span>
                  {r.reportType !== undefined && <Pill>{r.reportType}</Pill>}
                  <span className="dl-chip">{rangeText(r)}</span>
                </div>
                {open
                  ? (
                    <div className="dl-preview dl-preview-tall">
                      <MarkdownText text={r.markdown} labels={MD_LABELS} />
                    </div>
                  )
                  : <span className="dl-card-desc">生成于 {formatTime(r.createdAt)}</span>}
              </div>
              <div className="dl-card-foot">
                <IconAction
                  label={open ? '收起正文' : '查看正文'}
                  icon={<IconBrowseOutline16 size={16} />}
                  onClick={() => { setOpenId(open ? '' : r.id) }}
                />
                <IconAction
                  label="导出 Markdown"
                  disabled={props.busy}
                  icon={<IconDownloadOutline16 size={16} />}
                  onClick={() => void doExport(r.id)}
                />
                <IconAction
                  label="删除报告"
                  danger
                  disabled={props.busy}
                  icon={<IconTrashOutline16 size={16} />}
                  onClick={() => void props.run(async () => {
                    const res = await props.dailyLog.deleteReport(r.id)
                    if (!res.ok) throw new Error(errText(res.error))
                    if (open) setOpenId('')
                  })}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
