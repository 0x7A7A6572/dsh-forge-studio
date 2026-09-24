/**
 * 「其他配置」页签里手工别名的状态与动作（host 侧实现并已测：`setAlias` / `aliasList`）。
 *
 * 别名只影响**展示层合并**（显示并成一行、计价按 canonical 算），账本一个字不动。
 * 它以前挂在价表页的 `usePricingPanel` 上，现在独立成一个 hook：两个页签各有一份 busy /
 * msg，别名操作的成败就落在别名卡上，而不是印在「价表来源」那行小字里让人去另一个页签找。
 *
 * 弹窗里「归到哪个模型」的候选仍是当前价表 —— 由面板把 `options` 传进来，本 hook 不重复拉价表。
 */
import { useCallback, useEffect, useState } from 'react'
import type { UsageBillingRemote } from '../../core/remote.ts'
import type { SubmitOutcome } from './usePricingPanel.ts'

/** 别名行（展示层合并用）。 */
export interface AliasRow {
  provider: string
  rawModel: string
  canonicalModel: string
}

/** 手工别名草稿（`<provider>/<原始 model>` + canonical）。 */
export interface AliasDraft {
  key: string
  canonical: string
}

export const EMPTY_ALIAS_DRAFT: AliasDraft = { key: '', canonical: '' }

export interface AliasHookProps {
  billing: UsageBillingRemote | undefined
}

/** hook 的返回值：`AliasPanel` 拿的是它，面板因此不自己持状态。 */
export type AliasState = ReturnType<typeof useAliasPanel>

export function useAliasPanel(props: AliasHookProps) {
  const { billing } = props
  const [aliases, setAliases] = useState<AliasRow[]>([])
  const [aliasDraft, setAliasDraft] = useState<AliasDraft>(EMPTY_ALIAS_DRAFT)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

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
  const bindAlias = useCallback(async (): Promise<SubmitOutcome> => {
    if (billing === undefined) return { ok: false, reason: '绑定失败' }
    const slash = aliasDraft.key.indexOf('/')
    const provider = slash < 0 ? '' : aliasDraft.key.slice(0, slash).trim()
    const rawModel = slash < 0 ? '' : aliasDraft.key.slice(slash + 1).trim()
    const canonicalModel = aliasDraft.canonical.trim()
    if (provider === '' || rawModel === '' || canonicalModel === '') {
      const reason = '别名要写「<provider>/<原始 model id>」与 canonical 模型名，两段都不能空'
      setMsg(reason)
      return { ok: false, reason }
    }
    setBusy(true)
    try {
      const r = await billing.setAlias({ provider, rawModel, canonicalModel })
      setMsg(r.ok ? `已绑定 ${provider}/${rawModel} → ${canonicalModel}` : '绑定失败')
      if (r.ok) setAliasDraft(EMPTY_ALIAS_DRAFT)
      return r.ok ? { ok: true } : { ok: false, reason: '绑定失败' }
    } catch {
      const reason = '绑定失败：远程通道不可用'
      setMsg(reason)
      return { ok: false, reason }
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

  return { aliases, aliasDraft, setAliasDraft, busy, msg, bindAlias, unbindAlias }
}
