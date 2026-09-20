/**
 * 工作报告 —— dsh 设置面板里的一级分区（对齐 Agent 预设分区的布局语言）。
 *
 * 结构：标题 + 引言 → 「对话式生成」模块（唯一主操作，点它关掉设置回到左侧对话）
 * → 页签（报告 / 数据源 / 模板，带计数）→ 当前页的卡片栅格。
 * 数据读写仍走 Typert remote（ctx.remote.dailyLog.*）；报告正文由宿主聊天 agent 经
 * daily_log_* 工具生成，这里只负责查看、导出与配置。
 *
 * 顶部开关「注册 /report 指令」读写 ctx.settingsScope 绑定的设置命名空间
 * （enableReportCommand，与 host 侧同一份）。它只管指令是否注册，工具按需注入
 * 走的是 host 侧 gate，与开关无关 —— 文案里必须说清这一点，别让人当成插件总开关。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Button, IconSendOutline14,  } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DailyLogRemote } from '../core/remote.ts'
import type { DailyLogConfig, ReportRecord, SourceRecord, TemplateRecord } from '../../types.ts'
import { errText } from './parts.tsx'
import { pluginVersion } from '../../version.ts'
import { ReportsView } from './reports-view.tsx'
import { SourcesView } from './sources-view.tsx'
import { TemplatesView } from './templates-view.tsx'

/** 分区内的页签。 */
type DailyLogTab = 'reports' | 'sources' | 'templates'

const TABS: readonly { id: DailyLogTab; label: string }[] = [
  { id: 'reports', label: '报告' },
  { id: 'sources', label: '数据源' },
  { id: 'templates', label: '模板' },
]

/** 注册侧注入的业务面（见 src/client/index.ts）。 */
export interface DailyLogSectionInjected {
  dailyLog: DailyLogRemote
  /** 设置命名空间 scope（enableReportCommand 开关的读写通道）。 */
  scope: SettingsScope<DailyLogConfig>
}

/** 开关行文案：关掉后模型仍可自行启用 —— 这句话是「开关作用范围」的唯一出口。 */
export const REPORT_COMMAND_SWITCH_TITLE = '注册 /report 指令'
export const REPORT_COMMAND_SWITCH_DESC = '关闭后无法用 /report 触发；模型仍可在需要时自行启用。'
export const REPORT_COMMAND_SWITCH_HINT = ''
  // '15 个工具默认不注册：新会话只挂一个 daily_log 派发器，其余工具与详细引导段在「按需启用」时才注入本会话。' +
  // '这个开关只决定 /report 指令是否注册，不是插件总开关。'

/** 分区组件完整 props：设置外壳 owner props + 插件注入面。 */
export type DailyLogSectionProps =
  PropsRuntime<'settings.section'> & InjectFace<DailyLogSectionInjected>

/** 工作报告分区。 */
export function DailyLogSection(props: DailyLogSectionProps): JSX.Element {
  const dailyLog = props.dailyLog
  const scope = props.scope
  // 设置快照：开关的当前值与可写性都从这里来（订阅变化 → 外部改动也实时反映）。
  const settings = useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot(),
  )
  const reportCommandEnabled = settings.value?.enableReportCommand ?? true
  const settingsWritable = settings.writable && settings.status !== 'unavailable'
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

  async function run(action: () => Promise<unknown>): Promise<boolean> {
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
  }

  /** 切换 /report 指令注册开关；失败只提示，不回弹（快照仍是 host 的真值）。 */
  async function toggleReportCommand(next: boolean): Promise<void> {
    setError('')
    try {
      await scope.set('enableReportCommand', next)
    } catch (e) {
      setError(errText(e))
    }
  }

  const _defaultTemplate = templates.find((t) => t.isDefault) ?? templates.find((t) => t.isBuiltin)
  const counts: Record<DailyLogTab, number> = {
    reports: reports.length,
    sources: sources.length,
    templates: templates.length,
  }

  return (
    <div className="dl-section" data-dsh-dailylog-ui="">
      <div className="dl-title-row">
        <h2 className="dl-title">工作报告</h2>
        <span className="dl-version" title="插件版本">v{pluginVersion()}</span>
      </div>
      <p className="dl-intro">
        把 Git 提交与本地 agent 会话，按模板整理成日报 / 周报 / 月报。正文由左侧对话里的 AI 撰写，这里管数据源、报告与模板。
      </p>

      <div className="dl-switch-row">
        <div className="dl-switch-copy">
          <span className="dl-switch-title">{REPORT_COMMAND_SWITCH_TITLE}</span>
          <p className="dl-switch-desc">{REPORT_COMMAND_SWITCH_DESC}</p>
          <p className="dl-switch-hint">{REPORT_COMMAND_SWITCH_HINT}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={reportCommandEnabled}
          aria-label={REPORT_COMMAND_SWITCH_TITLE}
          disabled={!settingsWritable}
          className={reportCommandEnabled ? 'dl-switch dl-switch-on' : 'dl-switch'}
          onClick={() => { void toggleReportCommand(!reportCommandEnabled) }}
        >
          <span className="dl-switch-knob" />
        </button>
      </div>

      <div className="dl-generate">
        <div className="dl-generate-copy">
          <span className="dl-generate-title">对话式生成</span>
          <p className="dl-generate-desc">
            在左侧对话里对 AI 说一句「帮我生成本周周报」：它会先与你确认时间范围与项目，扫描提交与本地会话，
            按模板归纳成业务化报告，经你确认后存档到「报告」。
          </p>
          {/* <div className="dl-generate-meta">
            <span>默认模板：{defaultTemplate?.name ?? '无'}{defaultTemplate?.isBuiltin === true ? '（内置）' : ''}</span>
            <span>数据源：{sources.length} 个</span>
            {sources.length === 0 && <Pill>先添加数据源</Pill>}
          </div> */}
        </div>
        <div className="dl-generate-action">
          <Button
            variant="outline"
            size="sm"
            icon={<IconSendOutline14 size={14} />}
            onClick={() => { props.close() }}
          >
            去对话生成
          </Button>
        </div>
      </div>

      <div className="dl-tabs" aria-label="工作报告页面">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'true' : undefined}
            className={tab === item.id ? 'dl-tab dl-tab-active' : 'dl-tab'}
            onClick={() => { setTab(item.id) }}
          >
            {item.label}
            <span className="dl-tab-count">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {error !== '' && <p className="dl-error" role="alert">{error}</p>}

      {tab === 'reports' && (
        <ReportsView dailyLog={dailyLog} reports={reports} busy={busy} run={run} />
      )}
      {tab === 'sources' && (
        <SourcesView dailyLog={dailyLog} sources={sources} busy={busy} run={run} />
      )}
      {tab === 'templates' && (
        <TemplatesView dailyLog={dailyLog} templates={templates} busy={busy} run={run} />
      )}
    </div>
  )
}
