/**
 * 费率：当前生效价表 + 来源徽标 + **自定义单价录入/删除** + 未计价历史重算。
 *
 * 录入走既有的 `setCustomPrice` / `removeCustomPrice` 远程方法（宿主侧的价表写入链），
 * 保存/删除后重新拉一次 `pricing()`，表格与「自定义」标记都来自同一次响应里的
 * `customKeys`（那正是「此刻仍然生效的自定义价」，不是本地记忆）。
 */

import { useCallback, useEffect, useState } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import type { Currency, CustomPriceInput, PriceEntry } from '../../types.ts'

interface Draft {
  key: string
  input: string
  cacheRead: string
  cacheWrite: string
  output: string
  currency: Currency
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
      setMsg(r.ok ? `已删除自定义价 ${key}（目录价已恢复）` : `删除失败：${key} 没有生效中的自定义价`)
    } catch {
      setMsg('删除失败：远程通道不可用')
    } finally {
      await reload().catch(() => { /* 同上 */ })
      setBusy(false)
    }
  }, [billing, reload])

  if (entries === null) return <div data-dsh-ub-empty>正在读取价表…</div>

  /** 「刷新失败」的两种来源：wire 层失败（error.message）与拉取层失败（value.ok=false + reason）。 */
  const failure = (reason: string): string => `刷新失败：${reason}（继续用内置价）`
  const field = (label: string, value: string, set: (next: string) => void): JSX.Element => (
    <label data-dsh-ub-sub>
      {label}
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        style={{ width: 72, marginLeft: 4 }}
      />
    </label>
  )

  return (
    <div data-dsh-usage-billing>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span data-dsh-ub-badge data-kind={source === 'live' ? undefined : 'warn'}>
          {source === 'live' ? '实时价' : '内置价'}
        </span>
        <span data-dsh-ub-sub>USD→CNY {usdToCny.toFixed(4)}</span>
        <button type="button" disabled={busy} onClick={async () => {
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
        }}>立即刷新</button>
        <button type="button" disabled={busy} onClick={async () => {
          if (billing === undefined) return
          setBusy(true)
          const r = await billing.repricing()
          setMsg(r.ok ? `已重算 ${r.value.changed} 条未计价历史` : '重算失败')
          setBusy(false)
        }}>重算未计价历史</button>
      </div>
      {msg === '' ? null : <p data-dsh-ub-sub>{msg}</p>}

      <section style={{ marginTop: 12 }}>
        <div data-dsh-ub-sub>自定义单价（每百万 token；保存后立即追加一条价表快照，只影响此后的新账）</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <label data-dsh-ub-sub>
            模型 key
            <input
              placeholder="provider/model"
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              style={{ width: 220, marginLeft: 4 }}
            />
          </label>
          {field('输入', draft.input, (v) => setDraft({ ...draft, input: v }))}
          {field('缓存读', draft.cacheRead, (v) => setDraft({ ...draft, cacheRead: v }))}
          {field('缓存写', draft.cacheWrite, (v) => setDraft({ ...draft, cacheWrite: v }))}
          {field('输出', draft.output, (v) => setDraft({ ...draft, output: v }))}
          <label data-dsh-ub-sub>
            币种
            <select
              value={draft.currency}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value as Currency })}
              style={{ marginLeft: 4 }}
            >
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => { void save() }}>保存自定义单价</button>
        </div>
      </section>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
        <thead>
          <tr data-dsh-ub-sub><th align="left">模型</th><th align="right">输入</th><th align="right">缓存读</th><th align="right">缓存写</th><th align="right">输出</th><th align="left">币种</th><th align="left">操作</th></tr>
        </thead>
        <tbody>
          {Object.entries(entries).map(([key, e]) => (
            <tr key={key}>
              <td>
                {key}
                {customKeys.includes(key) ? <span data-dsh-ub-badge data-kind="warn">自定义</span> : null}
              </td>
              <td align="right">{e.input}</td><td align="right">{e.cacheRead}</td>
              <td align="right">{e.cacheWrite}</td><td align="right">{e.output}</td>
              <td>{e.currency}</td>
              <td>
                {customKeys.includes(key) ? (
                  <button type="button" disabled={busy} aria-label={`删除 ${key}`}
                    onClick={() => { void remove(key) }}>删除</button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p data-dsh-ub-sub>单位：每百万 token。「立即刷新」与「重算」都以那一刻的账本与价表为准。</p>
      <p data-dsh-ub-sub>上次快照时间以费率来源与「立即刷新」结果为准；账本记录每行都带所用快照 id 可追溯。</p>
    </div>
  )
}
