/**
 * 侧栏入口卡（slot: sidebar.footer.action）—— 两个色块指标（月 / 今）+ 预算叠加条；
 * 收起成 36px rail 时文字与条都藏起来，只留一个预算饼图。
 *
 * 版式保留原样（这一条要的是「本月花了多少」），明细在点击后弹出的 popup 里
 * （components/BillingPopover.tsx）。卡上那条是叠加条，与 popup 里那两条不是同一件：
 * 档位只由 `evaluateBudget` 决定（ok / warn / over）。
 * 设置里关掉「侧边栏底部」这个入口时整卡不渲染（见 hooks/useEntryFlags.ts）。
 */
import { useEntryCard } from "../hooks/useEntryCard.ts";
import type { EntryDataProps } from "../hooks/useEntryCard.ts";
import { useEntryVisible } from "../hooks/useEntryFlags.ts";
import type { BillingScope } from "../core/config.ts";
import { BillingPopover } from "./BillingPopover.tsx";
import { BudgetStackBar } from "./BudgetStackBar.tsx";
import { PieBadge } from "./PieBadge.tsx";
import styles from "../styles/settings-section.module.css";

export interface EntryCardProps extends EntryDataProps {
  /** ownerProps：sidebar 是否为宽态（false = 56px rail）。 */
  wide: boolean;
  scope: BillingScope;
}

export function EntryCard(props: EntryCardProps): JSX.Element | null {
  const {
    load,
    failed,
    amountText,
    headlineText,
    todayText,
    budgetBar,
    unpricedText,
    segments,
    totalSegments,
    todaySegments,
    popoverBudget,
    seat,
    ...rest
  } = useEntryCard(props);
  const visible = useEntryVisible(props.scope, "sidebar");
  if (!visible) return null;

  return (
    <span
      className={styles.entrySeat + " " + styles.palette}
      ref={seat.anchorRef}
    >
      <button
        type="button"
        data-dsh-usage-billing
        data-dsh-ub-entry
        data-wide={String(props.wide)}
        data-dsh-ub-state={load}
        className={styles.entry}
        title={failed ? "计费：数据读取失败（点击重试）" : "计费"}
        aria-label={rest.ariaLabel}
        aria-expanded={seat.open}
        onClick={seat.toggle}
      >
        {props.wide ? null : (
          // 收起来（36px）时只留饼图：宽态有文字，不需要再放一个纯装饰的图标。
          <span
            className={styles.entryIcon}
            data-dsh-ub-icon
            aria-hidden="true"
          >
            <PieBadge
              ratio={budgetBar?.ratio ?? null}
              level={budgetBar?.level ?? "ok"}
              size={18}
            />
          </span>
        )}
        <span className={styles.entryText} data-dsh-ub-entry-text>
          <span className={styles.entryLine}>
            <span className={styles.entryAmount} data-dsh-ub-amount>
              <span
                className={styles.dot}
                title="本月已用"
                data-kind="used"
                aria-hidden="true"
              ></span>
              {`${amountText}`}
            </span>
            <span className={styles.entryToday} data-dsh-ub-today>
              <span
                className={styles.dot}
                title="今日已用"
                data-kind="today"
                aria-hidden="true"
              ></span>
              {`${todayText}`}
            </span>
          </span>
          {budgetBar === null ? null : (
            // 条在按钮里是纯装饰：它的口径已经在按钮的 aria-label 里说全了，
            // 单独给它一个 role 只会让屏幕阅读器在按钮内部再念一遍。
            <span className={styles.entryBudget} aria-hidden="true">
              <BudgetStackBar
                level={budgetBar.level}
                ratio={budgetBar.ratio}
                spentValue={budgetBar.spentValue}
                segments={segments}
              />
            </span>
          )}
        </span>
        {failed ? (
          <span className={styles.badge} data-dsh-ub-badge data-kind="error">
            读取失败
          </span>
        ) : null}
      </button>
      <BillingPopover
        seat={seat}
        headlineText={headlineText}
        totalSegments={totalSegments}
        todaySegments={todaySegments}
        unpricedText={unpricedText}
        budget={popoverBudget}
      />
    </span>
  );
}
