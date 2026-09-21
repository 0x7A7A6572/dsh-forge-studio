/**
 * 设置页（slot: settings.section）：预算、显示、用量视图（概览 / 趋势 / 明细）、价表与价面
 * （自定义单价 / 手工别名）、账本状态与口径说明。
 *
 * 版式跟着宿主设置页走：标题 18/600 + 引言 → 平铺分区（13/600 小标题，分区之间一条
 * 0.5px 分隔线，不给每块套描边 + 底色）——描边卡片是插件自己的语言，摆在宿主的设置面板里
 * 就是「格格不入」的那一半。开关一律用 primitives 的 Switch 原语，几档选一个的用本包的
 * SegmentedControl；计费弹窗取消后，三张用量视图也由这里的分段控件切换。
 */
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { pluginVersion } from '../../../version.ts'
import { BackfillLedgerNote } from '../../components/BackfillLedgerNote.tsx'
import { BackfillNotice } from '../../components/BackfillNotice.tsx'
import { BudgetNotice } from '../../components/BudgetNotice.tsx'
import { Card } from '../../components/Card.tsx'
import { FieldRow } from '../../components/FieldRow.tsx'
import { SegmentedControl } from '../../components/SegmentedControl.tsx'
import { StatCard } from '../../components/StatCard.tsx'
import { SwitchRow } from '../../components/SwitchRow.tsx'
import { PricingPanel } from './components/PricingPanel.tsx'
import { TabDetail } from '../tab-detail/TabDetail.tsx'
import { TabOverview } from '../tab-overview/TabOverview.tsx'
import { TabTrend } from '../tab-trend/TabTrend.tsx'
import { useSettingsSection } from './useSettingsSection.ts'
import type { SettingsSectionProps } from './useSettingsSection.ts'
import type { SegmentedOption } from '../../components/SegmentedControl.tsx'
import type { TabId } from '../../core/store.ts'
import styles from '../../styles/settings-section.module.css'

/** 用量视图：模块级常量（身份稳定），切换只换下面渲染的那一张。 */
const USAGE_VIEWS: ReadonlyArray<SegmentedOption<TabId>> = [
  { value: 'overview', label: '概览' },
  { value: 'trend', label: '趋势' },
  { value: 'detail', label: '明细' },
]

export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const {
    cfg, status, snapshotId, budgetDraft, setBudgetDraft, budgetText, locked, writable, entries,
    view, setView, budgetNotice, dismissBudgetNotice, dismissBackfill, backfillDismissed,
    commitBudget, onBudgetKeyDown,
    writeAutoRefresh, writeBudgetEnabled, writeIncludeSubagents, writeSidebarEntry, writeComposerEntry,
  } = useSettingsSection(props)

  return (
    <section className={styles.section} data-dsh-usage-billing>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>计费</h2>
        <span className={styles.version} title="插件版本">v{pluginVersion()}</span>
      </div>
      <p className={styles.intro}>
        统计各模型与子代理的用量与费用，按事件发生时刻的价表锁定；预算、入口开关与价表都在这里配置。
      </p>

      {/* 安装时刻未知（status 未到 / 取数失败 / installAt 非正）时不渲染：宁可不说，
          也不能报一个假日期。 */}
      {status !== null && status.installAt > 0 ? (
        <BackfillNotice
          installAt={status.installAt}
          dismissed={backfillDismissed}
          // 只读 scope 下写不入宿主：把按钮禁用，别留一个按了没反应的按钮。
          writable={writable}
          onDismiss={dismissBackfill}
        />
      ) : null}
      {budgetNotice === null ? null : (
        <BudgetNotice tier={budgetNotice.tier} pct={budgetNotice.pct} onDismiss={dismissBudgetNotice} />
      )}

      <Card title="预算">
        <SwitchRow
          title="启用月度预算"
          desc="关闭后不显示预算进度条，费用照常统计。"
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
        {/* 「未收录模型提醒」开关已按需求下线：未收录的计数与徽标是事实，口径不可关，
            这条解释性文案因此常驻（display.showUnpricedWarning 仍留在配置里，
            旧配置照旧兼容，只是不再有界面写入口）。 */}
        <div className={styles.row}>
          <div className={styles.rowCopy}>
            <span className={styles.rowTitle}>计费入口位置</span>
            <p className={styles.rowDesc}>本月费用和预算显示在哪一处，两处可分别开关。</p>
          </div>
        </div>
        <SwitchRow
          title="侧边栏底部"
          desc="显示本月费用、今日与预算进度。"
          checked={entries.sidebar}
          disabled={locked}
          onChange={writeSidebarEntry}
        />
        <SwitchRow
          title="输入框下方"
          desc="显示预算饼图与当前会话费用。"
          checked={entries.composer}
          disabled={locked}
          onChange={writeComposerEntry}
        />
        {/* 两处都关掉不是坏状态（设置页里照样看得到用量），但入口没了得说一声。 */}
        {entries.sidebar || entries.composer ? null : (
          <p className={styles.sub}>两处都关掉后，只能在这里查看用量。</p>
        )}
      </Card>

      {/* 只有卡头：开关管的是它下面那三张视图，所以不做成一张「正文在下」的卡。 */}
      <Card
        title="用量"
        extra={<SegmentedControl label="用量视图" value={view} options={USAGE_VIEWS} onChange={setView} />}
      />
      {view === 'overview' ? <TabOverview billing={props.billing} store={props.store} scope={props.scope} /> : null}
      {view === 'trend' ? <TabTrend billing={props.billing} store={props.store} /> : null}
      {view === 'detail' ? <TabDetail billing={props.billing} store={props.store} /> : null}

      <Card title="价表">
        <SwitchRow
          title="自动刷新价表"
          desc="按代理设置联网更新价目快照；关闭后只用内置价表与本地自定义价。"
          checked={cfg?.pricing?.autoRefresh ?? false}
          disabled={locked}
          onChange={writeAutoRefresh}
        />
      </Card>

      <PricingPanel billing={props.billing} />

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
