/**
 * 「价表」页签：当前生效价表 + 来源徽标 + 自定义单价 + 生效中的价目。
 *
 * 版式：三张卡片，价目走 DataTable —— 不手写 `<table>` 与内联 style 的裸 `<input>`。
 * 录入表单不常驻：卡片上只留一个入口按钮，点开才在弹窗里录入（CustomPriceDialog）。
 * 根节点是 Fragment（不是包一层 div）：三张卡片要和页签面板里的分节线一起排，
 * 中间夹一层容器会把 `.card + .card` 的链子断掉。
 *
 * 状态不在这里：`usePricingPanel` 由 SettingsSection 调一次（另一个页签的别名弹窗要用
 * 同一份价表做候选），本组件只画。
 */
import { useState } from 'react'
import { Calculator, Plus, RefreshCw } from 'lucide-react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { Card } from '../../../components/Card.tsx'
import { DataTable } from '../../../components/DataTable.tsx'
import type { TableColumn } from '../../../components/DataTable.tsx'
import { CustomPriceDialog } from './CustomPriceDialog.tsx'
import { priceSearch } from '../usePricingPanel.ts'
import type { PriceRow, PricingState } from '../usePricingPanel.ts'
import type { TierStatus } from '../../../../types.ts'
import styles from '../../../styles/settings-section.module.css'

/** 价目表列：`busy` 决定删除按钮能不能点，`remove` 是唯一的删除通道。 */
function priceColumns(busy: boolean, remove: (key: string) => void): ReadonlyArray<TableColumn<PriceRow>> {
  return [
    {
      key: 'model',
      header: '模型',
      main: true,
      sortValue: (row) => row.key,
      render: (row) => (
        <>
          {row.key}
          {row.custom ? <Tag tone="warning" className={styles.tagInline}>自定义</Tag> : null}
        </>
      ),
    },
    { key: 'input', header: '输入', align: 'right', sortValue: (row) => row.entry.input, render: (row) => row.entry.input },
    { key: 'cacheRead', header: '缓存读', align: 'right', sortValue: (row) => row.entry.cacheRead, render: (row) => row.entry.cacheRead },
    { key: 'cacheWrite', header: '缓存写', align: 'right', sortValue: (row) => row.entry.cacheWrite, render: (row) => row.entry.cacheWrite },
    { key: 'output', header: '输出', align: 'right', sortValue: (row) => row.entry.output, render: (row) => row.entry.output },
    { key: 'currency', header: '币种', sortValue: (row) => row.entry.currency, render: (row) => row.entry.currency },
    {
      key: 'ops',
      header: '操作',
      render: (row) => (row.custom ? (
        <Button
          variant="ghost" size="sm" disabled={busy}
          aria-label={`删除 ${row.key}`}
          onClick={() => { remove(row.key) }}
        >
          删除
        </Button>
      ) : null),
    },
  ]
}

/** 档位文案：只说此刻贵不贵、什么时候变。 */
function tierLabel(tier: TierStatus): string {
  if (tier.current === null) return '分时价尚未启用'
  const who = tier.current === 'peak' ? '高峰时段' : '空闲时段（按半价计）'
  if (tier.nextSwitchAt === null) return who
  const at = new Date(tier.nextSwitchAt)
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return `${who} · 下次 ${at.getMonth() + 1}/${at.getDate()} ${hm}`
}

export function PricingPanel(props: { state: PricingState }): JSX.Element {
  const {
    entries, rows, source, usdToCny, busy, msg, draft, setDraft, tier,
    save, remove, refreshPricing, repricing,
  } = props.state
  /** 单价录入弹窗的开合：纯界面状态，留在视图层（hook 只管数据与动作）。 */
  const [priceOpen, setPriceOpen] = useState(false)
  /** 价目表是本页签的主内容，默认摊开，只是允许折起来。 */
  const [tableOpen, setTableOpen] = useState(true)

  if (entries === null) return <div className={styles.empty} data-dsh-ub-empty>正在读取价表…</div>

  return (
    <>
      <Card
        title="价表来源"
        extra={(
          <div className={styles.toolbar}>
            <Button
              variant="outline" size="sm" disabled={busy} icon={<RefreshCw size={14} />}
              onClick={() => { void refreshPricing() }}
            >
              立即刷新
            </Button>
            <Button
              variant="ghost" size="sm" disabled={busy} icon={<Calculator size={14} />}
              onClick={() => { void repricing() }}
            >
              重算未计价历史
            </Button>
          </div>
        )}
      >
        <div className={styles.head}>
          <Tag tone={source === 'live' ? 'success' : 'warning'}>{source === 'live' ? '实时价' : '内置价'}</Tag>
          <span className={styles.sub}>USD → CNY {usdToCny.toFixed(4)}</span>
          {tier === null ? null : (
            <>
              <span className={styles.sub} data-dsh-ub-tier>{tierLabel(tier)}</span>
              <span className={styles.sub}>节假日数据到 {tier.holidayDataThrough} 年</span>
            </>
          )}
        </div>
        {msg === '' ? null : <div className={styles.notice} data-kind="info" role="status">{msg}</div>}
      </Card>

      <Card
        title="自定义单价"
        desc="每百万 token。保存后立即追加一条价表快照，只影响此后的新账"
        extra={(
          <Button
            variant="outline" size="sm" disabled={busy} icon={<Plus size={14} />}
            onClick={() => { setPriceOpen(true) }}
          >
            添加单价
          </Button>
        )}
      />

      <Card
        title="生效中的价目"
        desc="「立即刷新」与「重算」都以那一刻的账本与价表为准。"
        collapsible
        open={tableOpen}
        onToggle={() => { setTableOpen((previous) => !previous) }}
      >
        <DataTable
          columns={priceColumns(busy, (key) => { void remove(key) })}
          rows={rows}
          rowKey={(row) => row.key}
          empty="价表是空的（还没拉到任何价目）。"
          searchText={priceSearch}
          filterPlaceholder="过滤模型"
        />
      </Card>

      {/* 弹窗 portal 到 body，摆在 Fragment 里不会切断 `.card + .card` 的分节线。 */}
      {priceOpen ? (
        <CustomPriceDialog
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          onClose={() => { setPriceOpen(false) }}
          onSubmit={async () => {
            const outcome = await save()
            if (outcome.ok) setPriceOpen(false)
            return outcome
          }}
        />
      ) : null}
    </>
  )
}
