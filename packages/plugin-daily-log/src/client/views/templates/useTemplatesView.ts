/** 模板页的弹窗状态与卡片动作：null = 未打开；editing = null 表示新增。 */
import { useCallback, useState } from 'react'
import type { DailyLogRemote } from '../../core/remote.ts'
import type { RunAction } from '../../core/run-action.ts'
import { errText } from '../../core/format.ts'
import type { TemplateId, TemplateRecord } from '../../../types.ts'

export interface TemplatesViewProps {
  dailyLog: DailyLogRemote
  templates: readonly TemplateRecord[]
  busy: boolean
  run: RunAction
}

export interface TemplatesDialog {
  editing: TemplateRecord | null
}

export function useTemplatesView(props: TemplatesViewProps) {
  const { dailyLog, run } = props
  const [dialog, setDialog] = useState<TemplatesDialog | null>(null)

  const setDefault = useCallback((id: TemplateId) => {
    void run(async () => {
      const res = await dailyLog.setDefaultTemplate(id)
      if (!res.ok) throw new Error(errText(res.error))
    })
  }, [dailyLog, run])

  const removeTemplate = useCallback((id: TemplateId) => {
    void run(async () => {
      const res = await dailyLog.deleteTemplate(id)
      if (!res.ok) throw new Error(errText(res.error))
    })
  }, [dailyLog, run])

  return {
    dialog,
    setDefault,
    removeTemplate,
    openCreate: useCallback(() => { setDialog({ editing: null }) }, []),
    openEdit: useCallback((record: TemplateRecord) => { setDialog({ editing: record }) }, []),
    closeDialog: useCallback(() => { setDialog(null) }, []),
  }
}
