/**
 * 费率：当前生效价表 + 来源徽标 + 自定义单价录入/删除 + 未计价历史重算 + 手工别名。
 *
 * 版式：三块（价表来源 / 自定义单价 / 手工别名）各一张卡片，表单走 Input 原语 + FieldRow，
 * 价表与别名列表走 DataTable —— 不手写 `<table>` 与内联 style 的裸 `<input>`。
 */
import { Calculator, RefreshCw } from 'lucide-react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Currency } from '../../../types.ts'
import { Card } from '../../components/Card.tsx'
import { DataTable } from '../../components/DataTable.tsx'
import type { TableColumn } from '../../components/DataTable.tsx'
import { FieldRow } from '../../components/FieldRow.tsx'
import { priceSearch, useTabPricing } from './useTabPricing.ts'
import type { Draft, PriceRow, TabPricingProps } from './useTabPricing.ts'
import styles from '../../styles/settings-section.module.css'

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

/** 五个单价输入长得一样，抽一个渲染函数（纯排版，不含状态）。 */
function priceField(label: string, value: string, set: (next: string) => void): JSX.Element {
  return (
    <FieldRow label={label}>
      <Input
        className={styles.inputSm}
        inputMode="decimal"
        value={value}
        onChange={(event) => { set(event.currentTarget.value) }}
      />
    </FieldRow>
  )
}

export function TabPricing(props: TabPricingProps): JSX.Element {
  const {
    entries, rows, source, usdToCny, busy, msg, draft, setDraft, aliasDraft, setAliasDraft, aliases,
    save, remove, bindAlias, unbindAlias, refreshPricing, repricing,
  } = useTabPricing(props)

  if (entries === null) return <div className={styles.empty} data-dsh-ub-empty>正在读取价表…</div>

  /** 草稿的整段改写：`setDraft` 由 hook 持有，视图只做字段级合并。 */
  const patch = (part: Partial<Draft>): void => { setDraft({ ...draft, ...part }) }

  return (
    <div className={styles.section} data-dsh-usage-billing>
      <div className={styles.head}>
        <span className={styles.headTitle}>价表来源</span>
        <Tag tone={source === 'live' ? 'success' : 'warning'}>{source === 'live' ? '实时价' : '内置价'}</Tag>
        <span className={styles.sub}>USD → CNY {usdToCny.toFixed(4)}</span>
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
      </div>
      {msg === '' ? null : <div className={styles.notice} data-kind="info" role="status">{msg}</div>}

      <Card
        title="自定义单价"
        desc="每百万 token。保存后立即追加一条价表快照，只影响此后的新账；不写 ¥0 就不能把「没配价」伪装成免费。"
      >
        <FieldRow label="模型 key">
          <Input
            className={styles.inputMd}
            placeholder="provider/model"
            value={draft.key}
            onChange={(event) => { patch({ key: event.currentTarget.value }) }}
          />
        </FieldRow>
        {priceField('输入', draft.input, (v) => { patch({ input: v }) })}
        {priceField('缓存读', draft.cacheRead, (v) => { patch({ cacheRead: v }) })}
        {priceField('缓存写', draft.cacheWrite, (v) => { patch({ cacheWrite: v }) })}
        {priceField('输出', draft.output, (v) => { patch({ output: v }) })}
        <div className={styles.field}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>币种</span>
            <select
              className={styles.select}
              value={draft.currency}
              onChange={(event) => { patch({ currency: event.currentTarget.value as Currency }) }}
            >
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => { void save() }}>
            保存自定义单价
          </Button>
        </div>
      </Card>

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
      >
        <FieldRow label="原始 id">
          <Input
            className={styles.inputMd}
            placeholder="provider/raw-model"
            value={aliasDraft.key}
            onChange={(event) => { setAliasDraft({ ...aliasDraft, key: event.currentTarget.value }) }}
          />
        </FieldRow>
        <FieldRow label="canonical 模型">
          <Input
            className={styles.inputMd}
            placeholder="canonical-model"
            value={aliasDraft.canonical}
            onChange={(event) => { setAliasDraft({ ...aliasDraft, canonical: event.currentTarget.value }) }}
          />
        </FieldRow>
        <div className={styles.toolbar}>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => { void bindAlias() }}>
            保存别名
          </Button>
        </div>
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
    </div>
  )
}
