/**
 * 价面（设置-计费分区）：当前生效价表 + 来源徽标 + 自定义单价 + 手工别名。
 *
 * 版式：四块（价表来源 / 自定义单价 / 生效中的价目 / 手工别名）各一张卡片，价表走
 * DataTable —— 不手写 `<table>` 与内联 style 的裸 `<input>`。
 * 两条写入表单不常驻：卡片上只留一个入口按钮，点开才在弹窗里录入（对应 *Dialog）。
 * 根节点是 Fragment（不是包一层 div）：四张卡片要和外层设置分区的卡片一起排，
 * 分节线靠 `.card + .card`，中间夹一层容器会把链子断掉。
 */
import { useState } from 'react'
import { Calculator, Plus, RefreshCw } from 'lucide-react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { Card } from '../../../components/Card.tsx'
import { DataTable } from '../../../components/DataTable.tsx'
import type { TableColumn } from '../../../components/DataTable.tsx'
import { AliasDialog } from './AliasDialog.tsx'
import { CustomPriceDialog } from './CustomPriceDialog.tsx'
import { priceSearch, usePricingPanel } from '../usePricingPanel.ts'
import type { PriceRow, PricingPanelProps } from '../usePricingPanel.ts'
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

export function PricingPanel(props: PricingPanelProps): JSX.Element {
  const {
    entries, rows, source, usdToCny, busy, msg, draft, setDraft, aliasDraft, setAliasDraft, aliases,
    save, remove, bindAlias, unbindAlias, refreshPricing, repricing,
  } = usePricingPanel(props)
  /** 两个弹窗的开合：纯界面状态，留在视图层（hook 只管数据与动作）。 */
  const [priceOpen, setPriceOpen] = useState(false)
  const [aliasOpen, setAliasOpen] = useState(false)

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
        </div>
        {msg === '' ? null : <div className={styles.notice} data-kind="info" role="status">{msg}</div>}
      </Card>

      <Card
        title="自定义单价"
        desc="每百万 token。保存后立即追加一条价表快照，只影响此后的新账；不写 ¥0 就不能把「没配价」伪装成免费。"
        extra={(
          <Button
            variant="outline" size="sm" disabled={busy} icon={<Plus size={14} />}
            onClick={() => { setPriceOpen(true) }}
          >
            添加单价
          </Button>
        )}
      />

      <Card title="生效中的价目" desc="「立即刷新」与「重算」都以那一刻的账本与价表为准。">
        <DataTable
          columns={priceColumns(busy, (key) => { void remove(key) })}
          rows={rows}
          rowKey={(row) => row.key}
          empty="价表是空的（还没拉到任何价目）。"
          searchText={priceSearch}
          filterPlaceholder="过滤模型"
        />
      </Card>

      <Card
        title="手工别名"
        desc="把未收录 / 疑似改名的原始 id 绑到 canonical 模型；只在同一 provider 内合并展示，账本不动。"
        extra={(
          <Button
            variant="outline" size="sm" disabled={busy} icon={<Plus size={14} />}
            onClick={() => { setAliasOpen(true) }}
          >
            添加别名
          </Button>
        )}
      >
        {aliases.length === 0 ? <p className={styles.sub}>还没有手工别名。</p> : (
          <div className={styles.list}>
            {aliases.map((a) => (
              <div className={styles.aliasRow} key={`${a.provider}\u0000${a.rawModel}`}>
                <span className={styles.aliasText}>
                  {a.provider} / {a.rawModel} → {a.canonicalModel}
                </span>
                <Button
                  variant="ghost" size="sm" disabled={busy}
                  aria-label={`解绑 ${a.provider}/${a.rawModel}`}
                  onClick={() => { void unbindAlias(a.provider, a.rawModel) }}
                >
                  解绑
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 两个弹窗都 portal 到 body，摆在 Fragment 里不会切断 `.card + .card` 的分节线。 */}
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
      {aliasOpen ? (
        <AliasDialog
          draft={aliasDraft}
          setDraft={setAliasDraft}
          busy={busy}
          onClose={() => { setAliasOpen(false) }}
          onSubmit={async () => {
            const outcome = await bindAlias()
            if (outcome.ok) setAliasOpen(false)
            return outcome
          }}
        />
      ) : null}
    </>
  )
}
