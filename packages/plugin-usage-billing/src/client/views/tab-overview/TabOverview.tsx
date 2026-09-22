/**
 * 概览：单列堆叠四张卡 —— 累计 Token 消耗 / 今日 Token 消耗 / 最近活跃度 / 分模型消耗。
 */
import {
  NON_FINITE_PLACEHOLDER,
  backfilledDisclosure,
  formatCny,
  formatInt,
  formatPct,
  isUnpricedTotal,
} from "../../core/format.ts";
import {
  HEAT_WINDOWS,
  HEAT_WINDOW_LABEL,
  activeDays,
  cacheHitRate,
  longestStreak,
  sumDays,
  totalTokens,
  windowDays,
  windowStart,
} from "../../core/token-stats.ts";
import type { HeatWeeks } from "../../core/token-stats.ts";
import { Card } from "../../components/Card.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import type { TableColumn } from "../../components/DataTable.tsx";
import { HeroCard } from "../../components/HeroCard.tsx";
import { HeatChart } from "../../components/HeatChart.tsx";
import { HeatLegend } from "../../components/HeatLegend.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
import type { SegmentedOption } from "../../components/SegmentedControl.tsx";
import { useTabOverview } from "./useTabOverview.ts";
import type { TabOverviewProps } from "./useTabOverview.ts";
import type { DailyPoint, ModelRow } from "../../../view.ts";
import styles from "../../styles/settings-section.module.css";

/** 今日还没有用量时的零值（结构上与 DailyPoint 一致，避免到处写可选判断）。 */
const ZERO_DAY: DailyPoint = {
  day: "",
  costCny: 0,
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  calls: 0,
};

/** 活跃度时间窗：模块级常量（身份稳定），与「活跃度」卡片标题同排。 */
const HEAT_OPTIONS: ReadonlyArray<SegmentedOption<HeatWeeks>> =
  HEAT_WINDOWS.map((w) => ({ value: w, label: HEAT_WINDOW_LABEL[w] }));

/** 过滤用的可搜索文本（模块级常量：身份稳定，列表的 memo 才不会每帧重算）。 */
const modelSearch = (m: ModelRow): string =>
  m.providers.join(" ") + " " + m.model + " " + m.rawModels.join(" ");

/** 分模型表：与状态无关，模块级常量（不随渲染重建，列表 memo 才有效）。 */
const MODEL_COLUMNS: ReadonlyArray<TableColumn<ModelRow>> = [
  {
    key: "provider",
    header: "Provider",
    sortValue: (m) => m.providers.join(" / "),
    // 同名模型跨 provider 并成一行：provider 一个都不丢，全列出来。
    render: (m) => m.providers.join(" / "),
  },
  {
    key: "model",
    header: "模型",
    main: true,
    sortValue: (m) => m.model,
    render: (m) => m.model,
  },
  {
    key: "tokens",
    header: "总 Token",
    align: "right",
    sortValue: (m) => totalTokens(m),
    render: (m) => formatInt(totalTokens(m)),
  },
  {
    key: "input",
    header: "未命中输入",
    align: "right",
    sortValue: (m) => m.input,
    render: (m) => formatInt(m.input),
  },
  {
    key: "cacheRead",
    header: "缓存读",
    align: "right",
    sortValue: (m) => m.cacheRead,
    render: (m) => formatInt(m.cacheRead),
  },
  {
    key: "output",
    header: "输出",
    align: "right",
    sortValue: (m) => m.output,
    render: (m) => formatInt(m.output),
  },
  {
    key: "cost",
    header: "费用",
    align: "right",
    sortValue: (m) => m.costCny,
    // 未计价行绝不能显示 ¥0.00：那读起来是「免费」。零额 + 未计价时明确写未收录。
    render: (m) =>
      !m.priced && m.costCny === 0 ? (
        <span className={styles.unpriced}>未收录</span>
      ) : (
        <>{formatCny(m.costCny)}</>
      ),
  },
  {
    key: "note",
    header: "备注",
    nowrap: true,
    // 三段都是本单元格的直接文本节点：getByText 才读得到完整备注。
    render: (m) =>
      (!m.priced ? "未收录 · " : "") +
      (m.mixedRate ? "混合单价 · " : "") +
      (m.rawModels.length > 1 ? m.rawModels.length + " 个原始 id" : ""),
  },
];

/** 四格等宽指标（累计卡与今日卡同规格）。 */
function cells(
  t: Pick<DailyPoint, "input" | "cacheRead" | "output" | "calls">,
): ReadonlyArray<{ label: string; value: string }> {
  return [
    { label: "未命中输入", value: formatInt(t.input) },
    { label: "缓存读", value: formatInt(t.cacheRead) },
    { label: "输出", value: formatInt(t.output) },
    { label: "调用次数", value: formatInt(t.calls) },
  ];
}

export function TabOverview(props: TabOverviewProps): JSX.Element {
  const { data, weeks, setWeeks, showUnpricedWarning } = useTabOverview(props);

  if (data === null)
    return (
      <div className={styles.empty} data-dsh-ub-empty>
        正在读取用量…
      </div>
    );
  const { overview, todayKey, days, models } = data;
  // 唯一判据（client/core/format.ts）：整份账一行都没定价时，本页**所有**金额级数字都占位。
  const unpriced = isUnpricedTotal(overview.totalCny, overview.unpricedModels);
  const money = (n: number): string =>
    unpriced ? NON_FINITE_PLACEHOLDER : formatCny(n);

  const all = sumDays(days);
  const today = days.find((d) => d.day === todayKey) ?? ZERO_DAY;
  // 窗口以「今天」结尾（而不是最后一条记录）：最近几天没用量的空格子也要画出来。
  const windowDaysList = windowDays(
    days,
    windowStart(todayKey, weeks),
    todayKey,
  );
  const windowCost = windowDaysList.reduce((sum, d) => sum + d.costCny, 0);

  return (
    <div className={styles.section} data-dsh-usage-billing>
      <div className={styles.heroRow}>
        <HeroCard
          title="累计 Token 消耗"
          value={formatInt(totalTokens(all))}
          unit="总消耗 Token"
          cells={cells(all)}
          subtitle={
            <>
              累计费用 <span data-dsh-ub-money>{money(overview.totalCny)}</span>
              {" · "}缓存命中率 {formatPct(cacheHitRate(all))}
              {overview.unpricedModels.length > 0 ? (
                <>
                  {" · "}
                  <span className={styles.unpriced}>
                    {overview.unpricedModels.length + " 未收录"}
                  </span>
                </>
              ) : null}
              {backfilledDisclosure(overview.hasBackfilled) ? (
                <span className={styles.estimate} data-dsh-ub-estimate>
                  {" "}
                  · 含安装前估算
                </span>
              ) : null}
            </>
          }
        />

        <HeroCard
          title="今日 Token 消耗"
          value={formatInt(totalTokens(today))}
          unit="今日 Token"
          cells={cells(today)}
          subtitle={
            <>
              今日费用 <span data-dsh-ub-money>{money(overview.todayCny)}</span>
              {today.calls === 0 ? <span> · 今天还没有用量</span> : null}
            </>
          }
        />
      </div>

      <Card
        title="最近活跃度"
        extra={
          <SegmentedControl
            label="活跃度时间窗"
            value={weeks}
            options={HEAT_OPTIONS}
            onChange={setWeeks}
          />
        }
      >
        <HeatChart days={windowDaysList} unpriced={unpriced} />
        <div className={styles.activityFoot}>
          <HeatLegend />
          <span className={styles.sub}>
            活跃 {formatInt(activeDays(windowDaysList))} 天 · 最长连续{" "}
            {formatInt(longestStreak(windowDaysList))} 天{" · "}区间合计{" "}
            <span data-dsh-ub-money>{money(windowCost)}</span>
          </span>
        </div>
      </Card>

      <Card title="分模型消耗">
        <DataTable
          columns={MODEL_COLUMNS}
          rows={models}
          rowKey={(m) => m.key}
          empty="这个范围里还没有按模型的用量。"
          defaultSort={{ key: "tokens", dir: "desc" }}
          searchText={modelSearch}
          filterPlaceholder="过滤模型"
        />
      </Card>

      {/* 未收录提示条是**可关的偏好**（display.showUnpricedWarning）；卡里的金额与徽标
          是事实，不受该开关影响 —— 关掉的只是这条解释性文案。 */}
      {overview.unpricedModels.length > 0 && showUnpricedWarning ? (
        <p className={styles.estimate} data-dsh-ub-estimate>
          {overview.unpricedRows} 条记录涉及 {overview.unpricedModels.length}{" "}
          个未收录模型（
          {overview.unpricedModels.slice(0, 3).join("、")}），已按 ¥0
          计但未静默忽略 —— 到「设置 → 计费」里补单价即可。
        </p>
      ) : null}
    </div>
  );
}
