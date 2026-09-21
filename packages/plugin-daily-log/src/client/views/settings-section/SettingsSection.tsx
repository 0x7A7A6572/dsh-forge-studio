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
 * 走的是 host 侧 gate，与开关无关。
 */

import { Button, IconSendOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { pluginVersion } from '../../../version.ts'
import {
  DAILY_LOG_TABS, REPORT_COMMAND_SWITCH_DESC, REPORT_COMMAND_SWITCH_HINT,
  REPORT_COMMAND_SWITCH_TITLE, useSettingsSection,
} from './useSettingsSection.ts'
import type { SettingsSectionInjected } from './useSettingsSection.ts'
import { ReportsView } from '../reports/ReportsView.tsx'
import { SourcesView } from '../sources/SourcesView.tsx'
import { TemplatesView } from '../templates/TemplatesView.tsx'
import styles from '../../styles/settings-section.module.css'

/** 分区组件完整 props：设置外壳 owner props + 插件注入面。 */
export type SettingsSectionProps =
  PropsRuntime<'settings.section'> & InjectFace<SettingsSectionInjected>

/** 工作报告分区。 */
export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const {
    dailyLog, tab, setTab, sources, reports, templates, counts, error, busy, run,
    toggleReportCommand, reportCommandEnabled, settingsWritable,
  } = useSettingsSection(props)

  return (
    <div className={styles.root} data-dsh-dailylog-ui="">
      <div className={styles.titleRow}>
        <h2 className={styles.title}>工作报告</h2>
        <span className={styles.version} title="插件版本">v{pluginVersion()}</span>
      </div>
      <p className={styles.intro}>
        把 Git 提交与本地 agent 会话，按模板整理成日报 / 周报 / 月报。正文由左侧对话里的 AI 撰写，这里管数据源、报告与模板。
      </p>

      <div className={styles.switchRow}>
        <div className={styles.switchCopy}>
          <span className={styles.switchTitle}>{REPORT_COMMAND_SWITCH_TITLE}</span>
          <p className={styles.switchDesc}>{REPORT_COMMAND_SWITCH_DESC}</p>
          <p className={styles.switchHint}>{REPORT_COMMAND_SWITCH_HINT}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={reportCommandEnabled}
          aria-label={REPORT_COMMAND_SWITCH_TITLE}
          disabled={!settingsWritable}
          className={reportCommandEnabled ? styles.switch + ' ' + styles.switchOn : styles.switch}
          onClick={() => { void toggleReportCommand(!reportCommandEnabled) }}
        >
          <span className={styles.switchKnob} />
        </button>
      </div>

      <div className={styles.generate}>
        <div className={styles.generateCopy}>
          <span className={styles.generateTitle}>对话式生成</span>
          <p className={styles.generateDesc}>
            在左侧对话里对 AI 说一句「帮我生成本周周报」：它会先与你确认时间范围与项目，扫描提交与本地会话，
            按模板归纳成业务化报告，经你确认后存档到「报告」。
          </p>
        </div>
        <div className={styles.generateAction}>
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

      <div className={styles.tabs} aria-label="工作报告页面">
        {DAILY_LOG_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'true' : undefined}
            className={tab === item.id ? styles.tab + ' ' + styles.tabActive : styles.tab}
            onClick={() => { setTab(item.id) }}
          >
            {item.label}
            <span className={styles.tabCount}>{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {error !== '' && <p className={styles.error} role="alert">{error}</p>}

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
