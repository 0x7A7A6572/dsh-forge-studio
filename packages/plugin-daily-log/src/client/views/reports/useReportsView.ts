/**
 * 报告页的状态与动作：展开哪一张、导出、删除。
 */
import { useCallback, useState } from 'react'
import type { DailyLogRemote } from '../../core/remote.ts'
import type { RunAction } from '../../core/run-action.ts'
import { errText } from '../../core/format.ts'
import type { ReportId, ReportRecord } from '../../../types.ts'

export interface ReportsViewProps {
  dailyLog: DailyLogRemote
  reports: readonly ReportRecord[]
  busy: boolean
  run: RunAction
}

export function useReportsView(props: ReportsViewProps) {
  const { dailyLog, run } = props
  const [openId, setOpenId] = useState<ReportId | ''>('')

  /** 点同一张即收起（只允许展开一张：栅格列宽读长文太窄）。 */
  const toggleOpen = useCallback((id: ReportId) => {
    setOpenId((current) => (current === id ? '' : id))
  }, [])

  const exportReport = useCallback((id: ReportId) => {
    void run(async () => {
      // 导出目录缺省时由 host 读设置（outputDir → ~/daily-log-reports）；client API 层没有
      // 「可选形参」，缺省位必须显式传 undefined 占位，否则调用期抛 arity 错误。
      const res = await dailyLog.exportReport(id, undefined)
      if (res.ok) window.alert('已导出：' + res.value)
      else throw new Error(errText(res.error))
    })
  }, [dailyLog, run])

  const removeReport = useCallback((id: ReportId) => {
    void run(async () => {
      const res = await dailyLog.deleteReport(id)
      if (!res.ok) throw new Error(errText(res.error))
      setOpenId((current) => (current === id ? '' : current))
    })
  }, [dailyLog, run])

  return { openId, toggleOpen, exportReport, removeReport }
}
