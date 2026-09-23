/**
 * 工作报告分区的全部状态与动作。视图只读返回值，自己永远不碰 remote 与 scope。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DailyLogRemote } from '../../core/remote.ts'
import type { RunAction } from '../../core/run-action.ts'
import { errText } from '../../core/format.ts'
import type { DailyLogConfig, ReportRecord, SourceRecord, TemplateRecord } from '../../../types.ts'

/** 分区内的页签。 */
export type DailyLogTab = 'reports' | 'sources' | 'templates'

/** 页签顺序 = 展示顺序，计数由数据填。 */
export const DAILY_LOG_TABS: readonly { id: DailyLogTab; label: string }[] = [
  { id: 'reports', label: '报告' },
  { id: 'sources', label: '数据源' },
  { id: 'templates', label: '模板' },
]

/** 开关行文案：关掉后模型仍可自行启用 —— 这句话是「开关作用范围」的唯一出口。 */
export const REPORT_COMMAND_SWITCH_TITLE = '注册 /report 指令'
export const REPORT_COMMAND_SWITCH_DESC = '关闭后无法用 /report 触发；模型仍可在需要时自行启用。'
export const REPORT_COMMAND_SWITCH_HINT = ''

/** 注册侧注入的业务面（见 src/client/index.ts）。 */
export interface SettingsSectionInjected {
  dailyLog: DailyLogRemote
  /** 本插件配置表单（enableReportCommand 开关的读写通道）。 */
  scope: ConfigForm<DailyLogConfig>
}

/** 工作报告分区。 */
export function useSettingsSection(props: SettingsSectionInjected) {
  const { dailyLog, scope } = props
  // 设置快照：开关的当前值与可写性都从这里来（订阅变化 → 外部改动也实时反映）。
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const [tab, setTab] = useState<DailyLogTab>('reports')
  const [sources, setSources] = useState<readonly SourceRecord[]>([])
  const [reports, setReports] = useState<readonly ReportRecord[]>([])
  const [templates, setTemplates] = useState<readonly TemplateRecord[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [s, r, t] = await Promise.all([
      dailyLog.listSources(),
      dailyLog.listReports(),
      dailyLog.listTemplates(),
    ])
    if (s.ok) setSources(s.value)
    else setError(errText(s.error))
    if (r.ok) setReports(r.value)
    else setError(errText(r.error))
    if (t.ok) setTemplates(t.value)
    else setError(errText(t.error))
  }, [dailyLog])

  useEffect(() => { void refresh() }, [refresh])

  /** 所有写操作走这里：统一 busy / error，改完自动重拉。 */
  const run: RunAction = useCallback(async (action) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
      return true
    } catch (e) {
      setError(errText(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [refresh])

  /** 切换 /report 指令注册开关；失败只提示，不回弹（快照仍是 host 的真值）。 */
  const toggleReportCommand = useCallback(async (next: boolean): Promise<void> => {
    setError('')
    try {
      // dsh 0.1.7 起表单写入**拒绝时 resolve false**（旧版抛异常），两种都当失败。
      if (!await scope.set('enableReportCommand', next)) setError('配置写入被拒绝（当前没有写权限）')
    } catch (e) {
      setError(errText(e))
    }
  }, [scope])

  const counts: Record<DailyLogTab, number> = {
    reports: reports.length,
    sources: sources.length,
    templates: templates.length,
  }

  return {
    dailyLog,
    tab,
    setTab,
    sources,
    reports,
    templates,
    counts,
    error,
    busy,
    run,
    toggleReportCommand,
    reportCommandEnabled: settings.value?.enableReportCommand ?? true,
    settingsWritable: settings.writable && settings.status !== 'unavailable',
  }
}
