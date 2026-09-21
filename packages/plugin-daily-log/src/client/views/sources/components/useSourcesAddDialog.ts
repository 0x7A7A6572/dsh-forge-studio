/**
 * 新增数据源弹窗：DSH 工作区候选（一键添加）+ 手动路径。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DailyLogRemote } from '../../../core/remote.ts'
import type { RunAction } from '../../../core/run-action.ts'
import { errText } from '../../../core/format.ts'
import type { ProjectCandidate } from '../../../../types.ts'

export interface SourcesAddDialogProps {
  dailyLog: DailyLogRemote
  busy: boolean
  run: RunAction
  /** 已添加数量：变化即重拉候选，刷新「已添加」标记。 */
  sourcesLength: number
  onClose: () => void
}

export function useSourcesAddDialog(props: SourcesAddDialogProps) {
  const { dailyLog, run, sourcesLength } = props
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [author, setAuthor] = useState('')
  // DSH 工作区候选：null=读取中；[]=空。
  const [candidates, setCandidates] = useState<readonly ProjectCandidate[] | null>(null)
  const [wsError, setWsError] = useState('')

  // 打开即拉取；添加成功后（run 内刷新 → sources 数变化）重拉以刷新「已添加」标记。
  useEffect(() => {
    let cancelled = false
    setWsError('')
    void (async () => {
      const res = await dailyLog.listWorkspaceCandidates()
      if (cancelled) return
      if (res.ok) setCandidates(res.value)
      else {
        setCandidates([])
        setWsError(errText(res.error))
      }
    })()
    return () => { cancelled = true }
  }, [dailyLog, sourcesLength])

  const addManual = useCallback(() => {
    if (path.trim() === '') return
    void run(async () => {
      const res = await dailyLog.addSource({
        path: path.trim(),
        ...(label.trim() !== '' ? { label: label.trim() } : {}),
        ...(author.trim() !== '' ? { author: author.trim() } : {}),
      })
      if (!res.ok) throw new Error(errText(res.error))
      setPath(''); setLabel(''); setAuthor('')
    })
  }, [dailyLog, run, path, label, author])

  const addCandidate = useCallback((candidate: ProjectCandidate) => {
    void run(async () => {
      const res = await dailyLog.addSource({
        path: candidate.path, label: candidate.title, type: candidate.type,
      })
      if (!res.ok) throw new Error(errText(res.error))
    })
  }, [dailyLog, run])

  return {
    path, label, author, candidates, wsError,
    setPath, setLabel, setAuthor, addManual, addCandidate,
  }
}
