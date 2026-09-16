/** 费率：当前生效价表 + 来源徽标 + 自定义单价录入 + 未计价历史重算。 */

import { useCallback, useEffect, useState } from 'react'
import type { UsageBillingRemote } from '../core/remote.ts'
import type { BillingStore } from '../core/store.ts'
import type { PriceEntry } from '../../types.ts'

export function TabPricing(props: { billing: UsageBillingRemote; store: BillingStore }): JSX.Element {
  const { billing } = props
  const [entries, setEntries] = useState<Record<string, PriceEntry> | null>(null)
  const [source, setSource] = useState<'live' | 'default'>('default')
  const [usdToCny, setUsdToCny] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const reload = useCallback(async () => {
    const r = await billing.pricing()
    if (r.ok) { setEntries(r.value.entries); setSource(r.value.usdToCnySource); setUsdToCny(r.value.usdToCny) }
  }, [billing])

  useEffect(() => { void reload() }, [reload])

  if (entries === null) return <div data-dsh-ub-empty>正在读取价表…</div>

  /** 「刷新失败」的两种来源：wire 层失败（error.message）与拉取层失败（value.ok=false + reason）。 */
  const failure = (reason: string): string => `刷新失败：${reason}（继续用内置价）`

  return (
    <div data-dsh-usage-billing>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span data-dsh-ub-badge data-kind={source === 'live' ? undefined : 'warn'}>
          {source === 'live' ? '实时价' : '内置价'}
        </span>
        <span data-dsh-ub-sub>USD→CNY {usdToCny.toFixed(4)}</span>
        <button type="button" disabled={busy} onClick={async () => {
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
          setBusy(true)
          const r = await billing.repricing()
          setMsg(r.ok ? `已重算 ${r.value.changed} 条未计价历史` : '重算失败')
          setBusy(false)
        }}>重算未计价历史</button>
      </div>
      {msg === '' ? null : <p data-dsh-ub-sub>{msg}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
        <thead>
          <tr data-dsh-ub-sub><th align="left">模型</th><th align="right">输入</th><th align="right">缓存读</th><th align="right">缓存写</th><th align="right">输出</th><th align="left">币种</th></tr>
        </thead>
        <tbody>
          {Object.entries(entries).map(([key, e]) => (
            <tr key={key}>
              <td>{key}</td>
              <td align="right">{e.input}</td><td align="right">{e.cacheRead}</td>
              <td align="right">{e.cacheWrite}</td><td align="right">{e.output}</td>
              <td>{e.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p data-dsh-ub-sub>单位：每百万 token。自定义单价在设置页录入，写入后即追加一条价表快照 —— 只影响此后的新账。</p>
      <p data-dsh-ub-sub>上次快照时间以费率来源与「立即刷新」结果为准；账本记录每行都带所用快照 id 可追溯。</p>
    </div>
  )
}
