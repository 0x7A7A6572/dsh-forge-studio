/**
 * 新增 / 编辑模板弹窗：编辑段与预览段共用同一份草稿。
 */
import { useCallback, useState } from 'react'
import type { DailyLogRemote } from '../../../core/remote.ts'
import type { RunAction } from '../../../core/run-action.ts'
import { errText } from '../../../core/format.ts'
import { joinTemplate, parseTemplate } from '../../../../template.ts'
import type { TemplateRecord } from '../../../../types.ts'

export interface TemplateEditDialogProps {
  dailyLog: DailyLogRemote
  busy: boolean
  run: RunAction
  /** null = 新增。 */
  editing: TemplateRecord | null
  onClose: () => void
}

export function useTemplateEditDialog(props: TemplateEditDialogProps) {
  const { dailyLog, run, editing, onClose } = props
  const initial = editing !== null ? parseTemplate(editing.content) : null
  const [name, setName] = useState(editing?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.promptSection ?? '')
  const [skeleton, setSkeleton] = useState(initial?.skeletonSection ?? '')
  const [preview, setPreview] = useState(false)

  const save = useCallback(() => {
    if (name.trim() === '' || skeleton.trim() === '') return
    const content = joinTemplate(prompt, skeleton)
    void run(async () => {
      const res = editing !== null
        ? await dailyLog.updateTemplate(editing.id, { name: name.trim(), content })
        : await dailyLog.createTemplate({ name: name.trim(), content })
      if (!res.ok) throw new Error(errText(res.error))
      onClose()
    })
  }, [dailyLog, run, editing, name, prompt, skeleton, onClose])

  return {
    name, setName,
    prompt, setPrompt,
    skeleton, setSkeleton,
    preview, setPreview,
    save,
    canSave: !props.busy && name.trim() !== '' && skeleton.trim() !== '',
  }
}
