/**
 * 设置页（slot: settings.section）：**常驻主区是「用量」模块**（概览 / 趋势 / 明细三选一），
 * 下面才是三个页签 —— 配置（预算 / 显示）、价表（刷新 + 价表来源 + 自定义单价 + 价目）、
 * 其他配置（账本状态 / 手工别名）。计费口径说明段常驻在最下面，不随页签走。
 *
 * 版式跟着宿主设置页走：标题 18/600 + 引言 → 平铺分区（13/600 小标题，分区之间一条
 * 0.5px 分隔线，不给每块套描边 + 底色）——描边卡片是插件自己的语言，摆在宿主的设置面板里
 * 就是「格格不入」的那一半。开关一律用 primitives 的 Switch 原语，几档选一个的用本包的
 * SegmentedControl；页签用宿主「内置插件」页那条下划线页签（不是等宽胶囊轨道）。
 *
 * 长内容折起来：概览的「最近活跃度 / 分模型消耗」默认收起（状态在 useSettingsSection 里，
 * 切视图不丢），价目表与手工别名也可折。
 *
 * 两个页签面板**首次选中才挂载、之后只隐藏**：与宿主「内置插件」页同一姿态，别名卡片的
 * 开合、价目表的排序与过滤在来回切页签时不丢（细节见 useSettingsSection 的 visitedTabs）。
 */
import { useId } from "react";
import type { KeyboardEvent } from "react";
import { Input } from "@deepseek-ai/dsh-client-ui-primitives";
import { pluginVersion } from "../../../version.ts";
import { BackfillLedgerNote } from "../../components/BackfillLedgerNote.tsx";
import { BackfillNotice } from "../../components/BackfillNotice.tsx";
import { BudgetNotice } from "../../components/BudgetNotice.tsx";
import { Card } from "../../components/Card.tsx";
import { FieldRow } from "../../components/FieldRow.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { SwitchRow } from "../../components/SwitchRow.tsx";
import { AliasPanel } from "./components/AliasPanel.tsx";
import { PricingPanel } from "./components/PricingPanel.tsx";
import { useAliasPanel } from "./useAliasPanel.ts";
import { usePricingPanel } from "./usePricingPanel.ts";
import { SETTINGS_TABS, useSettingsSection } from "./useSettingsSection.ts";
import type { SettingsSectionProps } from "./useSettingsSection.ts";
import { TabDetail } from "../tab-detail/TabDetail.tsx";
import { TabOverview } from "../tab-overview/TabOverview.tsx";
import { TabTrend } from "../tab-trend/TabTrend.tsx";
import type { SegmentedOption } from "../../components/SegmentedControl.tsx";
import type { TabId } from "../../core/store.ts";
import styles from "../../styles/settings-section.module.css";

/** 用量视图：模块级常量（身份稳定），切换只换下面渲染的那一张。 */
const USAGE_VIEWS: ReadonlyArray<SegmentedOption<TabId>> = [
  { value: "overview", label: "概览" },
  { value: "trend", label: "趋势" },
  { value: "detail", label: "明细" },
];

export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const {
    cfg,
    status,
    snapshotId,
    budgetDraft,
    setBudgetDraft,
    budgetText,
    locked,
    writable,
    entries,
    view,
    setView,
    tab,
    setTab,
    visitedTabs,
    activityOpen,
    modelsOpen,
    toggleActivity,
    toggleModels,
    budgetNotice,
    dismissBudgetNotice,
    dismissBackfill,
    backfillDismissed,
    commitBudget,
    onBudgetKeyDown,
    writeAutoRefresh,
    writeBudgetEnabled,
    writeIncludeSubagents,
    writeShowTierCurve,
    writeSidebarEntry,
    writeComposerEntry,
  } = useSettingsSection(props);

  // 价表与别名在分区这一层各调**一次**：别名弹窗的候选就是同一份价表的 key，两个面板因此
  // 都是纯展示，各自页签的 busy / msg 不会串到另一个页签上去。
  const pricing = usePricingPanel({ billing: props.billing });
  const aliases = useAliasPanel({ billing: props.billing });
  /** 页签与面板的 DOM id 前缀：同一份 id 不能在页面上撞车（宿主按 id 关联 tab 与面板）。 */
  const tabsId = useId();

  /** 方向键在页签间移动（与宿主页签条同一套键盘约定），选中即聚焦。 */
  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = (index + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length;
        break;
      case "ArrowRight":
        next = (index + 1) % SETTINGS_TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = SETTINGS_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const list = event.currentTarget.parentElement;
    const item = SETTINGS_TABS[next];
    if (list === null || item === undefined) return;
    setTab(item.id);
    list.querySelectorAll<HTMLButtonElement>('[role="tab"]').item(next).focus();
  };

  return (
    <section className={styles.section} data-dsh-usage-billing>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>计费</h2>
        <span className={styles.version} title="插件版本">
          v{pluginVersion()}
        </span>
      </div>
      <p className={styles.intro}>
        统计各模型与子代理的用量与费用，按事件发生时刻的价表锁定。
      </p>

      {/* 提示条不属于任何一个页签：它们是「这一页真的被看到」时才算数的一次性提醒
          （判定见 useSettingsSection），被折进某个页签里就等于悄悄不提醒了。 */}
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
        <BudgetNotice
          tier={budgetNotice.tier}
          pct={budgetNotice.pct}
          onDismiss={dismissBudgetNotice}
        />
      )}

      {/* 常驻主区：用量模块。只有卡头（开关管的是它下面那三张视图），三张视图由这里切换 ——
          所以它不归任何页签，翻配置时也能看着数。 */}
      <Card
        title="用量"
        extra={
          <SegmentedControl
            label="用量视图"
            value={view}
            options={USAGE_VIEWS}
            onChange={setView}
          />
        }
      />
      <div className={styles.usageView}>
        {view === "overview" ? (
          <TabOverview
            billing={props.billing}
            store={props.store}
            scope={props.scope}
            query={props.query}
            revalidate={props.revalidate}
            activityOpen={activityOpen}
            modelsOpen={modelsOpen}
            onToggleActivity={toggleActivity}
            onToggleModels={toggleModels}
          />
        ) : null}
        {view === "trend" ? (
          <TabTrend
            billing={props.billing}
            store={props.store}
            query={props.query}
            revalidate={props.revalidate}
          />
        ) : null}
        {view === "detail" ? (
          <TabDetail
            billing={props.billing}
            store={props.store}
            query={props.query}
            revalidate={props.revalidate}
          />
        ) : null}
      </div>

      <div className={styles.tabs} role="tablist" aria-label="计费设置">
        {SETTINGS_TABS.map((item, index) => (
          <button
            key={item.id}
            id={`${tabsId}-tab-${item.id}`}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={tab === item.id}
            aria-controls={`${tabsId}-panel-${item.id}`}
            data-active={tab === item.id ? "true" : undefined}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => {
              setTab(item.id);
            }}
            onKeyDown={(event) => {
              onTabKeyDown(event, index);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {SETTINGS_TABS.map((item) =>
        item.id === tab || visitedTabs.has(item.id) ? (
          <div
            key={item.id}
            id={`${tabsId}-panel-${item.id}`}
            className={styles.panel}
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-${item.id}`}
            hidden={tab !== item.id}
          >
            {item.id === "config" ? (
              <>
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
                      onChange={(event) => {
                        setBudgetDraft(event.target.value);
                      }}
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
                  {/* 峰谷时段图只是画法：关掉不影响判档与计价，两个入口的弹窗一起跟着关。 */}
                  <SwitchRow
                    title="显示峰谷时段图"
                    desc="在计费弹窗顶部画出今日的峰谷费率曲线；分时价未启用时本来就不会出现。"
                    checked={cfg?.display?.showTierCurve ?? true}
                    disabled={locked}
                    onChange={writeShowTierCurve}
                  />

                  <div className={styles.settingsEntry}>
                    <div className={styles.row}>
                      <div className={styles.rowCopy}>
                        <span className={styles.rowTitle}>计费入口位置</span>
                        <p className={styles.rowDesc}>
                          本月费用和预算显示在哪一处，两处可分别开关。
                        </p>
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
                  </div>
                </Card>
              </>
            ) : null}

            {item.id === "pricing" ? (
              <>
                <Card title="价表">
                  <SwitchRow
                    title="自动刷新价表"
                    desc="按代理设置联网更新价目快照；关闭后只用内置价表与本地自定义价。"
                    checked={cfg?.pricing?.autoRefresh ?? false}
                    disabled={locked}
                    onChange={writeAutoRefresh}
                  />
                </Card>
                <PricingPanel state={pricing} />
              </>
            ) : null}

            {item.id === "other" ? (
              <>
                <Card title="账本状态">
                  <div className={styles.stats}>
                    <StatCard
                      label="账本行数"
                      value={status?.rows ?? 0}
                      hint="已折叠的原始记录"
                    />
                    <StatCard
                      label="已折叠会话"
                      value={status?.sessions ?? 0}
                    />
                    <StatCard
                      label="价表快照"
                      value={status?.snapshots ?? 0}
                      hint="每笔价目变更一份"
                    />
                  </div>
                  {/* 状态区在 status 未到 / 取数失败时停在 0 行：这是占位，不是「账本是空的」。 */}
                  <div className={styles.sub}>
                    账本 {status?.rows ?? 0} 行 · 已折叠 {status?.sessions ?? 0}{" "}
                    个会话
                  </div>
                  {/* 重建期间行数会一直长：必须说明，否则中间值看起来就是「数不全」。 */}
                  {status?.rebuild.active === true ? (
                    <div className={styles.sub}>
                      正在重建账本，数字会逐步补齐。
                    </div>
                  ) : null}
                </Card>
                <AliasPanel state={aliases} rows={pricing.rows} />
              </>
            ) : null}
          </div>
        ) : null,
      )}

      {/* status 未到（或取数失败）时传 null：说明段渲染占位，绝不把「不知道」印成 1970。
          status 到了但 installAt 不是正数（命名空间里从未落盘）同样按未知处理。
          口径说明是常驻的（不可关），所以它不折进任何页签。 */}
      <BackfillLedgerNote
        installAt={status === null ? null : status.installAt}
        snapshotId={snapshotId}
      />
    </section>
  );
}
