/**
 * 会话库一键导入（穿梭框）：左「可导入」右「待导入」，确认后逐个添加。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DailyLogRemote } from '../../../core/remote.ts'
import { errText } from '../../../core/format.ts'
import type { ProjectCandidate } from '../../../../types.ts'

export interface ImportProjectsDialogProps {
  dailyLog: DailyLogRemote
  onClose: () => void
  onImported: () => void
}

export function useImportProjectsDialog(props: ImportProjectsDialogProps) {
  const { dailyLog, onImported } = props
  const [discovered, setDiscovered] = useState<readonly ProjectCandidate[] | null>(null)
  const [left, setLeft] = useState<readonly ProjectCandidate[]>([])
  const [right, setRight] = useState<readonly ProjectCandidate[]>([])
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError('')
    void (async () => {
      const res = await dailyLog.discoverSessionProjects()
      if (cancelled) return
      if (!res.ok) {
        setDiscovered([])
        setError(errText(res.error))
        return
      }
      setDiscovered(res.value)
      setLeft(res.value.filter((c) => !c.added))
    })()
    return () => { cancelled = true }
  }, [dailyLog])

  const moveToRight = useCallback((candidate: ProjectCandidate) => {
    setLeft((prev) => prev.filter((x) => x.path !== candidate.path))
    setRight((prev) => (prev.some((x) => x.path === candidate.path) ? prev : [...prev, candidate]))
  }, [])

  const moveToLeft = useCallback((candidate: ProjectCandidate) => {
    setRight((prev) => prev.filter((x) => x.path !== candidate.path))
    setLeft((prev) =>
      prev.some((x) => x.path === candidate.path)
        ? prev
        : [...prev, candidate].sort((a, b) => a.path.localeCompare(b.path)),
    )
  }, [])

  const pickAll = useCallback(() => {
    setRight((prev) => [...prev, ...left.filter((x) => !prev.some((y) => y.path === x.path))])
    setLeft([])
  }, [left])

  const clearAll = useCallback(() => {
    setLeft((prev) => [...prev, ...right].sort((a, b) => a.path.localeCompare(b.path)))
    setRight([])
  }, [right])

  const importSelected = useCallback(() => {
    if (right.length === 0) return
    setBusy(true)
    setResult('')
    void (async () => {
      const failed: string[] = []
      let okCount = 0
      for (const c of right) {
        const res = await dailyLog.addSource({ path: c.path, label: c.title, type: c.type })
        if (res.ok) okCount++
        else failed.push(c.title + '（' + errText(res.error) + '）')
      }
      setRight([])
      setResult(
        failed.length > 0
          ? '已导入 ' + okCount + ' 个，失败 ' + failed.length + ' 个：' + failed.join('；')
          : '已导入 ' + okCount + ' 个项目',
      )
      onImported()
      // 导入后重扫，把已添加项从「可导入」移走。
      const res = await dailyLog.discoverSessionProjects()
      if (res.ok) {
        setDiscovered(res.value)
        setLeft(res.value.filter((c) => !c.added))
      }
      setBusy(false)
    })()
  }, [dailyLog, right, onImported])

  return {
    discovered, left, right, error, result, busy,
    moveToRight, moveToLeft, pickAll, clearAll, importSelected,
  }
}
