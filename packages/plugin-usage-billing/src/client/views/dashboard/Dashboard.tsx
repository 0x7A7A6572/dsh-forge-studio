/**
 * 仪表盘弹窗（slot: shell.overlay）。
 *
 * 版式层用 primitives 的 `Modal`（body portal + Escape + 点遮罩关闭 + role=dialog），
 * 不自绘遮罩与关闭按钮 —— 自绘那一版没有 Escape、没有 aria-modal，而且
 * `shell.overlay` 是 click-through 层，指针事件得自己 opt-in，很容易漏。
 * 弹窗内容根节点带 `data-dsh-usage-billing`（样式不依赖它，纯测试钩子 + 作用域语义）。
 */
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TabId } from '../../core/store.ts'
import { BUDGET_TIERS } from '../../../budget.ts'
import { formatPct } from '../../core/format.ts'
import { BackfillNotice } from '../../components/BackfillNotice.tsx'
import { useDashboard } from './useDashboard.ts'
import type { DashboardProps } from './useDashboard.ts'
import { TabOverview } from '../tab-overview/TabOverview.tsx'
import { TabTrend } from '../tab-trend/TabTrend.tsx'
import { TabHeatmap } from '../tab-heatmap/TabHeatmap.tsx'
import { TabDetail } from '../tab-detail/TabDetail.tsx'
import { TabPricing } from '../tab-pricing/TabPricing.tsx'
import styles from '../../styles/settings-section.module.css'

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'trend', label: '趋势' },
  { id: 'heatmap', label: '热力图' },
  { id: 'detail', label: '明细' },
  { id: 'pricing', label: '费率' },
]

export function Dashboard(props: DashboardProps): JSX.Element | null {
  const {
    open, tab, setTab, closePanel, installAt, cfg, settingsWritable,
    budgetNotice, dismissBudgetNotice, dismissBackfill,
  } = useDashboard(props)

  return (
    <Modal
      open={open}
      onClose={closePanel}
      title="计费"
      closeLabel="关闭"
      description=""
      className={styles.modal}
      contentClassName={styles.modalContent}
    >
      <div className={styles.section} data-dsh-usage-billing data-dsh-ub-panel>
        {/* 安装时刻未知（status 未到 / 取数失败 / installAt 非正）时不渲染：宁可不说，
            也不能报一个假日期。 */}
        {installAt > 0 ? (
          <BackfillNotice
            installAt={installAt}
            dismissed={cfg?.notices?.backfillDismissed === true}
            // 只读 scope 下写不入宿主：把按钮禁用，别留一个按了没反应的按钮。
            writable={settingsWritable}
            onDismiss={dismissBackfill}
          />
        ) : null}
        {/* 跨档提醒：与回填提示条同一姿态（左侧色条 + 右下角操作），关闭只影响本次弹窗，
            「每月每档一次」由已落盘的 notices.budgetNotified 保证。 */}
        {budgetNotice !== null ? (
          <div
            className={styles.notice}
            data-dsh-usage-billing data-dsh-ub-budget-notice data-kind="warn" role="status"
          >
            <span>
              月度预算已用 {formatPct(budgetNotice.pct, 0)}，跨过{' '}
              {formatPct(BUDGET_TIERS[budgetNotice.tier - 1], 0)} 档 —— 每个「月份 + 档位」只提醒一次。
            </span>
            <div className={styles.noticeFoot}>
              <Button variant="ghost" size="sm" onClick={dismissBudgetNotice}>知道了</Button>
            </div>
          </div>
        ) : null}

        <nav className={styles.tabnav} data-dsh-ub-tabs aria-label="计费视图">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                className={active ? styles.tab + ' ' + styles.tabActive : styles.tab}
                aria-current={active ? 'page' : undefined}
                onClick={() => { setTab(t.id) }}
              >
                {t.label}
              </button>
            )
          })}
        </nav>

        {tab === 'overview' ? <TabOverview billing={props.billing} store={props.store} scope={props.scope} /> : null}
        {tab === 'trend' ? <TabTrend billing={props.billing} store={props.store} /> : null}
        {tab === 'heatmap' ? <TabHeatmap billing={props.billing} store={props.store} /> : null}
        {tab === 'detail' ? <TabDetail billing={props.billing} store={props.store} /> : null}
        {tab === 'pricing' ? <TabPricing billing={props.billing} store={props.store} /> : null}
      </div>
    </Modal>
  )
}
