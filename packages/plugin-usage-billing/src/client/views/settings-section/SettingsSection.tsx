/**
 * 设置页（slot: settings.section）：预算、显示偏好、价表刷新、账本状态、口径说明。
 *
 * 版式对齐 plugin-memory 的设置分区：标题 + 版本号 + 引言 → 分组卡片（开关行 + 说明）
 * → 常驻口径说明。开关一律用 primitives 的 Switch 原语（role=switch + 必填可访问名），
 * 不手写 `<input type="checkbox">`。
 */
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { pluginVersion } from '../../../version.ts'
import { Card } from '../../components/Card.tsx'
import { FieldRow } from '../../components/FieldRow.tsx'
import { StatCard } from '../../components/StatCard.tsx'
import { SwitchRow } from '../../components/SwitchRow.tsx'
import { BackfillLedgerNote } from '../../components/BackfillLedgerNote.tsx'
import { useSettingsSection } from './useSettingsSection.ts'
import type { SettingsSectionProps } from './useSettingsSection.ts'
import styles from '../../styles/settings-section.module.css'

export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const {
    cfg, status, snapshotId, budgetDraft, setBudgetDraft, budgetText, locked,
    commitBudget, onBudgetKeyDown,
    writeAutoRefresh, writeBudgetEnabled, writeIncludeSubagents, writeShowUnpricedWarning,
  } = useSettingsSection(props)

  return (
    <section className={styles.section} data-dsh-usage-billing>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>计费</h2>
        <span className={styles.version} title="插件版本">v{pluginVersion()}</span>
      </div>
      <p className={styles.intro}>
        统计本机各模型与子代理的用量与费用，按事件发生时刻的价表锁定；预算与显示口径在这里配置。
      </p>

      <Card title="预算">
        <SwitchRow
          title="启用月度预算"
          desc="关闭后侧栏与概览页都不显示预算进度条（费用统计照常）。"
          checked={cfg?.budget?.enabled ?? false}
          disabled={locked}
          onChange={writeBudgetEnabled}
        />
        <FieldRow label="月度预算上限" note="人民币，仅用于进度提示">
          <Input
            className={styles.inputMd}
            inputMode="decimal"
            value={budgetDraft ?? budgetText}
            onChange={(event) => { setBudgetDraft(event.target.value) }}
            onBlur={commitBudget}
            onKeyDown={onBudgetKeyDown}
            disabled={locked || !(cfg?.budget?.enabled ?? false)}
            aria-label="月度预算上限"
          />
        </FieldRow>
      </Card>

      <Card title="显示">
        <SwitchRow
          title="包含子代理用量"
          desc="把子代理产生的调用一并计入；关闭后只统计主会话。"
          checked={cfg?.display?.includeSubagents ?? false}
          disabled={locked}
          onChange={writeIncludeSubagents}
        />
        <SwitchRow
          title="未收录模型提醒"
          desc="只关掉概览页那条解释性文案；未收录的计数与徽标是事实，永远保留。"
          checked={cfg?.display?.showUnpricedWarning ?? true}
          disabled={locked}
          onChange={writeShowUnpricedWarning}
        />
      </Card>

      <Card title="价表">
        <SwitchRow
          title="自动刷新价表"
          desc="按代理设置联网更新价目快照；关闭后只用内置价表与本地自定义价。"
          checked={cfg?.pricing?.autoRefresh ?? false}
          disabled={locked}
          onChange={writeAutoRefresh}
        />
      </Card>

      <Card title="账本状态">
        <div className={styles.stats}>
          <StatCard label="账本行数" value={status?.rows ?? 0} hint="已折叠的原始记录" />
          <StatCard label="已折叠会话" value={status?.sessions ?? 0} />
          <StatCard label="价表快照" value={status?.snapshots ?? 0} hint="每笔价目变更一份" />
        </div>
        {/* 状态区在 status 未到 / 取数失败时停在 0 行：这是占位，不是「账本是空的」。 */}
        <div className={styles.sub}>账本 {status?.rows ?? 0} 行 · 已折叠 {status?.sessions ?? 0} 个会话</div>
      </Card>

      {/* status 未到（或取数失败）时传 null：说明段渲染占位，绝不把「不知道」印成 1970。
          status 到了但 installAt 不是正数（命名空间里从未落盘）同样按未知处理。 */}
      <BackfillLedgerNote installAt={status === null ? null : status.installAt} snapshotId={snapshotId} />
    </section>
  )
}
