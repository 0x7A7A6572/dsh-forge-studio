/**
 * 费率：当前生效价表 + 来源徽标 + **自定义单价录入/删除** + 未计价历史重算 + 手工别名。
 *
 * 录入走既有的 `setCustomPrice` / `removeCustomPrice` 远程方法（宿主侧的价表写入链），
 * 保存/删除后重新拉一次 `pricing()`，表格与「自定义」标记都来自同一次响应里的
 * `customKeys`（那正是「此刻仍然生效的自定义价」，不是本地记忆）。
 *
 * 版式：三块（价表来源 / 自定义单价 / 手工别名）各一张卡片，表单走 Input 原语 + FieldRow，
 * 价表与别名列表走 DataTable —— 不再手写 `<table>` 与内联 style 的裸 `<input>`。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import { Card, FieldRow } from './components/kit.tsx'
import { DataTable } from './components/data-table.tsx'
import type { DataTableColumn } from './components/data-table.tsx'
import type { Currency, CustomPriceInput, PriceEntry } from '../../types.ts'

interface Draft {
  key: string
  input: string
  cacheRead: string
  cacheWrite: string
  output: string
  currency: Currency
}

/** 表格行：目录价 + 「此刻是否仍有自定义价生效」（来自同一次 pricing 响应）。 */
interface PriceRow {
  key: string
  entry: PriceEntry
  custom: boolean
}

/** 别名行（展示层合并用）。 */
interface AliasRow {
  provider: string
  rawModel: string
  canonicalModel: string
}

const EMPTY_DRAFT: Draft = { key: '', input: '', cacheRead: '', cacheWrite: '', output: '', currency: 'CNY' }

/** 单个单价输入：空串/非数字/负数一律视为无效（null），而不是悄悄当成 0。 */
function price(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** 校验草稿；key 必须是非空的 `<provider>/<model>`。**校验不过绝不发远程调用。** */
function validateDraft(draft: Draft): { ok: true; entry: CustomPriceInput } | { ok: false; reason: string } {
  // 只按第一个 '/' 切：model id 自身可能带 '/'，按全部切会把它们吃掉。
  const slash = draft.key.indexOf('/')
  const provider = slash < 0 ? '' : draft.key.slice(0, slash).trim()
  const model = slash < 0 ? '' : draft.key.slice(slash + 1).trim()
  if (provider === '' || model === '') return { ok: false, reason: '模型 key 必须是 <provider>/<model> 形式，且两段都非空' }
  const input = price(draft.input)
  const cacheRead = price(draft.cacheRead)
  const cacheWrite = price(draft.cacheWrite)
  const output = price(draft.output)
  if (input === null || cacheRead === null || cacheWrite === null || output === null) {
    return { ok: false, reason: '四个单价都必须是不小于 0 的数字' }
  }
  return { ok: true, entry: { provider, model, currency: draft.currency, input, cacheRead, cacheWrite, output } }
}

export function TabPricing(props: {
  billing: UsageBillingRemote | undefined
  store: BillingStore
}): JSX.Element {
  const { billing } = props
  const [entries, setEntries] = useState<Record<string, PriceEntry> | null>(null)
  const [customKeys, setCustomKeys] = useState<string[]>([])
  const [source, setSource] = useState<'live' | 'default'>('default')
  const [usdToCny, setUsdToCny] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  /** 手工别名草稿（`<provider>/<原始 model>` + canonical）。 */
  const [aliasDraft, setAliasDraft] = useState({ key: '', canonical: '' })
  const [aliases, setAliases] = useState<AliasRow[]>([])

  const reload = useCallback(async () => {
    if (billing === undefined) return
    const r = await billing.pricing()
    if (r.ok) {
      setEntries(r.value.entries)
      setSource(r.value.usdToCnySource)
      setUsdToCny(r.value.usdToCny)
      // 宽松 codec 透传：旧 host 的响应可能没有这个字段，缺省按「没有自定义价」处理。
      setCustomKeys(r.value.customKeys ?? [])
    }
  }, [billing])

  useEffect(() => {
    if (billing === undefined) return
    let alive = true
    void (async () => {
      const r = await billing.pricing()
      if (!alive || !r.ok) return
      setEntries(r.value.entries)
      setSource(r.value.usdToCnySource)
      setUsdToCny(r.value.usdToCny)
      setCustomKeys(r.value.customKeys ?? [])
    })().catch(() => {
      // wire 层 reject：价表留在「正在读取价表…」，不制造 unhandled rejection。
    })
    return () => { alive = false }
  }, [billing])

  /** 保存草稿；校验不过只报错，不发远程调用。 */
  const save = useCallback(async () => {
    if (billing === undefined) return
    const checked = validateDraft(draft)
    if (!checked.ok) { setMsg(checked.reason); return }
    setBusy(true)
    try {
      const r = await billing.setCustomPrice(checked.entry)
      setMsg(r.ok ? `已保存 ${checked.entry.provider}/${checked.entry.model}` : '保存失败')
      if (r.ok) setDraft(EMPTY_DRAFT)
    } catch {
      setMsg('保存失败：远程通道不可用')
    } finally {
      await reload().catch(() => { /* 刷新失败时保留上一次的表格 */ })
      setBusy(false)
    }
  }, [billing, draft, reload])

  /** 删除某个自定义价（host 侧有目录价时回落目录价，纯自定义则移除条目）。 */
  const remove = useCallback(async (key: string) => {
    if (billing === undefined) return
    setBusy(true)
    try {
      const r = await billing.removeCustomPrice(key)
      // 两个失败分支不是一回事：`!r.ok` 是宿主写入/通道出错（例如只读 scope），
      // `r.value.ok === false` 才是「这个 key 本来就没有生效中的自定义价」。
      setMsg(!r.ok
        ? `删除失败：${r.error.message}`
        : r.value.ok
          ? `已删除自定义价 ${key}（目录价已恢复）`
          : `删除失败：${key} 没有生效中的自定义价`)
    } catch {
      setMsg('删除失败：远程通道不可用')
    } finally {
      await reload().catch(() => { /* 同上 */ })
      setBusy(false)
    }
  }, [billing, reload])

  /** 手工别名列表（host 侧实现并已测：`setAlias` / `aliasList`）。只影响展示层合并。 */
  const reloadAliases = useCallback(async () => {
    if (billing === undefined) return
    const r = await billing.aliasList()
    if (r.ok) setAliases(r.value.aliases)
  }, [billing])

  useEffect(() => {
    if (billing === undefined) return
    let alive = true
    void billing.aliasList().then((r) => {
      if (alive && r.ok) setAliases(r.value.aliases)
    }).catch(() => {
      // 别名表取不到就留空：它只影响展示层合并，不该把整张价表拖成错误态。
    })
    return () => { alive = false }
  }, [billing])

  /** 绑定：只按第一个 '/' 切（model id 自身可能带 '/'），三段都非空才发远程调用。 */
  const bindAlias = useCallback(async () => {
    if (billing === undefined) return
    const slash = aliasDraft.key.indexOf('/')
    const provider = slash < 0 ? '' : aliasDraft.key.slice(0, slash).trim()
    const rawModel = slash < 0 ? '' : aliasDraft.key.slice(slash + 1).trim()
    const canonicalModel = aliasDraft.canonical.trim()
    if (provider === '' || rawModel === '' || canonicalModel === '') {
      setMsg('别名要写「<provider>/<原始 model id>」与 canonical 模型名，两段都不能空')
      return
    }
    setBusy(true)
    try {
      const r = await billing.setAlias({ provider, rawModel, canonicalModel })
      setMsg(r.ok ? `已绑定 ${provider}/${rawModel} → ${canonicalModel}` : '绑定失败')
      if (r.ok) setAliasDraft({ key: '', canonical: '' })
    } catch {
      setMsg('绑定失败：远程通道不可用')
    } finally {
      await reloadAliases().catch(() => { /* 保留上一次的列表 */ })
      setBusy(false)
    }
  }, [billing, aliasDraft, reloadAliases])

  /** 解绑：`canonicalModel: null`，之后该原始 id 恢复独立成行。 */
  const unbindAlias = useCallback(async (provider: string, rawModel: string) => {
    if (billing === undefined) return
    setBusy(true)
    try {
      const r = await billing.setAlias({ provider, rawModel, canonicalModel: null })
      setMsg(r.ok ? `已解绑 ${provider}/${rawModel}` : '解绑失败')
    } catch {
      setMsg('解绑失败：远程通道不可用')
    } finally {
      await reloadAliases().catch(() => { /* 同上 */ })
      setBusy(false)
    }
  }, [billing, reloadAliases])

  if (entries === null) return <div className="ub-empty" data-dsh-ub-empty>正在读取价表…</div>

  /** 「刷新失败」的两种来源：wire 层失败（error.message）与拉取层失败（value.ok=false + reason）。 */
  const failure = (reason: string): string => `刷新失败：${reason}（继续用内置价）`
  const rows: PriceRow[] = Object.entries(entries).map(([key, entry]) => ({
    key, entry, custom: customKeys.includes(key),
  }))
  const priceField = (label: string, value: string, set: (next: string) => void): JSX.Element => (
    <FieldRow label={label}>
      <Input
        className="ub-input-sm"
        inputMode="decimal"
        value={value}
        onChange={(event) => set(event.currentTarget.value)}
      />
    </FieldRow>
  )

  const columns: ReadonlyArray<DataTableColumn<PriceRow>> = [
    {
      key: 'model',
      header: '模型',
      main: true,
      render: (row) => (
        <>
          {row.key}
          {row.custom ? <Tag tone="warning" className="ub-tag-inline">自定义</Tag> : null}
        </>
      ),
    },
    { key: 'input', header: '输入', align: 'right', render: (row) => row.entry.input },
    { key: 'cacheRead', header: '缓存读', align: 'right', render: (row) => row.entry.cacheRead },
    { key: 'cacheWrite', header: '缓存写', align: 'right', render: (row) => row.entry.cacheWrite },
    { key: 'output', header: '输出', align: 'right', render: (row) => row.entry.output },
    { key: 'currency', header: '币种', render: (row) => row.entry.currency },
    {
      key: 'ops',
      header: '操作',
      render: (row) => (row.custom ? (
        <Button
          variant="ghost" size="sm" disabled={busy}
          aria-label={`删除 ${row.key}`}
          onClick={() => { void remove(row.key) }}
        >
          删除
        </Button>
      ) : null),
    },
  ]

  return (
    <div className="ub-section" data-dsh-usage-billing>
      <div className="ub-head">
        <span className="ub-head-title">价表来源</span>
        <Tag tone={source === 'live' ? 'success' : 'warning'}>{source === 'live' ? '实时价' : '内置价'}</Tag>
        <span className="ub-sub">USD → CNY {usdToCny.toFixed(4)}</span>
        <div className="ub-toolbar">
          <Button
            variant="outline" size="sm" disabled={busy}
            onClick={async () => {
              if (billing === undefined) return
              setBusy(true)
              const r = await billing.refreshPricing(true)
              // brief 原文是 `r.ok ? ... : r.value.reason`：RemoteResult 的失败分支没有 value，
              // 且「拉到一半失败」是 ok:true + value.ok=false，按 r.ok 判会把失败报成「已更新 0 条」。
              setMsg(!r.ok
                ? failure(r.error.message)
                : r.value.ok
                  ? `已更新 ${r.value.entries ?? 0} 条价目`
                  : failure(r.value.reason ?? '未知原因'))
              await reload(); setBusy(false)
            }}
          >
            立即刷新
          </Button>
          <Button
            variant="ghost" size="sm" disabled={busy}
            onClick={async () => {
              if (billing === undefined) return
              setBusy(true)
              const r = await billing.repricing()
              setMsg(r.ok ? `已重算 ${r.value.changed} 条未计价历史` : '重算失败')
              setBusy(false)
            }}
          >
            重算未计价历史
          </Button>
        </div>
      </div>
      {msg === '' ? null : <div className="ub-notice" data-kind="info" role="status">{msg}</div>}

      <Card
        title="自定义单价"
        desc="每百万 token。保存后立即追加一条价表快照，只影响此后的新账；不写 ¥0 就不能把「没配价」伪装成免费。"
      >
        <FieldRow label="模型 key">
          <Input
            className="ub-input-md"
            placeholder="provider/model"
            value={draft.key}
            onChange={(event) => setDraft({ ...draft, key: event.currentTarget.value })}
          />
        </FieldRow>
        {priceField('输入', draft.input, (v) => setDraft({ ...draft, input: v }))}
        {priceField('缓存读', draft.cacheRead, (v) => setDraft({ ...draft, cacheRead: v }))}
        {priceField('缓存写', draft.cacheWrite, (v) => setDraft({ ...draft, cacheWrite: v }))}
        {priceField('输出', draft.output, (v) => setDraft({ ...draft, output: v }))}
        <div className="ub-field">
          <label className="ub-field">
            <span className="ub-field-label">币种</span>
            <select
              className="ub-select"
              value={draft.currency}
              onChange={(event) => setDraft({ ...draft, currency: event.currentTarget.value as Currency })}
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
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.key} empty="价表是空的（还没拉到任何价目）。" />
      </Card>

      <Card
        title="手工别名"
        desc="把未收录 / 疑似改名的原始 id 绑到 canonical 模型；只在同一 provider 内合并展示，账本不动。"
      >
        <FieldRow label="原始 id">
          <Input
            className="ub-input-md"
            placeholder="provider/raw-model"
            value={aliasDraft.key}
            onChange={(event) => setAliasDraft({ ...aliasDraft, key: event.currentTarget.value })}
          />
        </FieldRow>
        <FieldRow label="canonical 模型">
          <Input
            className="ub-input-md"
            placeholder="canonical-model"
            value={aliasDraft.canonical}
            onChange={(event) => setAliasDraft({ ...aliasDraft, canonical: event.currentTarget.value })}
          />
        </FieldRow>
        <div className="ub-toolbar">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => { void bindAlias() }}>
            保存别名
          </Button>
        </div>
        {aliases.length === 0 ? <p className="ub-sub">还没有手工别名。</p> : (
          <div className="ub-list">
            {aliases.map((a) => (
              <div className="ub-alias-row" key={`${a.provider}\u0000${a.rawModel}`}>
                <span className="ub-alias-text">
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
