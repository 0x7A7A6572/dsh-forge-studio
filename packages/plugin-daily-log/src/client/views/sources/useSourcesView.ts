/** 数据源页的弹窗开合与行内动作。 */
import { useCallback, useState } from 'react'
import type { DailyLogRemote } from '../../core/remote.ts'
import type { RunAction } from '../../core/run-action.ts'
import { errText } from '../../core/format.ts'
import type { SourceId, SourceRecord } from '../../../types.ts'

export interface SourcesViewProps {
  dailyLog: DailyLogRemote
  sources: readonly SourceRecord[]
  busy: boolean
  run: RunAction
}

export function useSourcesView(props: SourcesViewProps) {
  const { dailyLog, run } = props
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const removeSource = useCallback((id: SourceId) => {
    void run(async () => {
      const res = await dailyLog.removeSource(id)
      if (!res.ok) throw new Error(errText(res.error))
    })
  }, [dailyLog, run])

  /** 导入完成后借 run 重拉一次列表（动作本身由弹窗自己发）。 */
  const refresh = useCallback(() => {
    void run(async () => undefined)
  }, [run])

  return {
    addOpen,
    importOpen,
    openAdd: useCallback(() => { setAddOpen(true) }, []),
    closeAdd: useCallback(() => { setAddOpen(false) }, []),
    openImport: useCallback(() => { setImportOpen(true) }, []),
    closeImport: useCallback(() => { setImportOpen(false) }, []),
    removeSource,
    refresh,
  }
}
