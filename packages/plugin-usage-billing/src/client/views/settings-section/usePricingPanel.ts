/**
 * 「价表」页签的状态与动作：当前生效价表 + 来源徽标 + **自定义单价录入/删除** +
 * 未计价历史重算 + 刷新。
 *
 * 录入走既有的 `setCustomPrice` / `removeCustomPrice` 远程方法（宿主侧的价表写入链），
 * 保存/删除后重新拉一次 `pricing()`，表格与「自定义」标记都来自同一次响应里的
 * `customKeys`（那正是「此刻仍然生效的自定义价」，不是本地记忆）。
 *
 * 手工别名**不在这个 hook 里**：它搬去了「其他配置」页签（见 useAliasPanel.ts）。两个
 * 页签各自的 busy / msg 因此也只落在自己那张卡上 —— 以前共用一份时，别名操作的反馈会
 * 印在另一个页签的「价表来源」卡里，切过去才看得见。
 */
import { useCallback, useEffect, useState } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { Currency, CustomPriceInput, PriceEntry, TierStatus } from '../../../types.ts'

export interface Draft {
  key: string
  input: string
  cacheRead: string
  cacheWrite: string
  output: string
  currency: Currency
}

/** 表格行：目录价 + 「此刻是否仍有自定义价生效」（来自同一次 pricing 响应）。 */
export interface PriceRow {
  key: string
  entry: PriceEntry
  custom: boolean
}

/** 提交结果：弹窗据此决定关窗，还是把原因留在弹窗里。 */
export type SubmitOutcome = { ok: true } | { ok: false; reason: string }

export const EMPTY_DRAFT: Draft = { key: '', input: '', cacheRead: '', cacheWrite: '', output: '', currency: 'CNY' }

/** 价表的可搜索文本（模块级常量：身份稳定）。 */
export const priceSearch = (row: PriceRow): string => row.key + ' ' + row.entry.currency

/** 单个单价输入：空串/非数字/负数一律视为无效（null），而不是悄悄当成 0。 */
function price(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** 校验草稿；key 必须是非空的 `<provider>/<model>`。**校验不过绝不发远程调用。** */
export function validateDraft(draft: Draft): { ok: true; entry: CustomPriceInput } | { ok: false; reason: string } {
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

export interface PricingHookProps {
  billing: UsageBillingRemote | undefined
}

/** hook 的返回值：面板拿的是它，`PricingPanel` 因此不自己持状态（见 SettingsSection 的调用处）。 */
export type PricingState = ReturnType<typeof usePricingPanel>

export function usePricingPanel(props: PricingHookProps) {
  const { billing } = props
  const [entries, setEntries] = useState<Record<string, PriceEntry> | null>(null)
  const [customKeys, setCustomKeys] = useState<string[]>([])
  const [source, setSource] = useState<'live' | 'default'>('default')
  const [usdToCny, setUsdToCny] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  /** 峰谷状态：旧宿主不发这个字段，缺省当「没有」处理。 */
  const [tier, setTier] = useState<TierStatus | null>(null)

  const reload = useCallback(async () => {
    if (billing === undefined) return
    const r = await billing.pricing()
    if (r.ok) {
      setEntries(r.value.entries)
      setSource(r.value.usdToCnySource)
      setUsdToCny(r.value.usdToCny)
      // 宽松 codec 透传：旧 host 的响应可能没有这个字段，缺省按「没有自定义价」处理。
      setCustomKeys(r.value.customKeys ?? [])
      setTier(r.value.tier ?? null)
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
      setTier(r.value.tier ?? null)
    })().catch(() => {
      // wire 层 reject：价表留在「正在读取价表…」，不制造 unhandled rejection。
    })
    return () => { alive = false }
  }, [billing])

  /** 保存草稿；校验不过只报错，不发远程调用。返回结果给弹窗决定关不关。 */
  const save = useCallback(async (): Promise<SubmitOutcome> => {
    if (billing === undefined) return { ok: false, reason: '保存失败' }
    const checked = validateDraft(draft)
    if (!checked.ok) { setMsg(checked.reason); return { ok: false, reason: checked.reason } }
    setBusy(true)
    try {
      const r = await billing.setCustomPrice(checked.entry)
      setMsg(r.ok ? `已保存 ${checked.entry.provider}/${checked.entry.model}` : '保存失败')
      if (r.ok) setDraft(EMPTY_DRAFT)
      return r.ok ? { ok: true } : { ok: false, reason: '保存失败' }
    } catch {
      const reason = '保存失败：远程通道不可用'
      setMsg(reason)
      return { ok: false, reason }
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

  /** 「刷新失败」的两种来源：wire 层失败（error.message）与拉取层失败（value.ok=false + reason）。 */
  const refreshPricing = useCallback(async () => {
    if (billing === undefined) return
    const failure = (reason: string): string => `刷新失败：${reason}（继续用内置价）`
    setBusy(true)
    const r = await billing.refreshPricing(true)
    // RemoteResult 的失败分支没有 value，且「拉到一半失败」是 ok:true + value.ok=false，
    // 按 r.ok 判会把失败报成「已更新 0 条」。
    setMsg(!r.ok
      ? failure(r.error.message)
      : r.value.ok
        ? `已更新 ${r.value.entries ?? 0} 条价目${r.value.partial === true ? '（部分模型未更新）' : ''}`
        : failure(r.value.reason ?? '未知原因'))
    await reload()
    setBusy(false)
  }, [billing, reload])

  const repricing = useCallback(async () => {
    if (billing === undefined) return
    setBusy(true)
    const r = await billing.repricing()
    setMsg(r.ok ? `已重算 ${r.value.changed} 条未计价历史` : '重算失败')
    setBusy(false)
  }, [billing])

  const rows: PriceRow[] = entries === null ? [] : Object.entries(entries).map(([key, entry]) => ({
    key, entry, custom: customKeys.includes(key),
  }))

  return {
    entries, rows, source, usdToCny, busy, msg, draft, setDraft, tier,
    save, remove, refreshPricing, repricing,
  }
}
