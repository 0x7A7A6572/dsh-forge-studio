/**
 * 手工别名弹窗：两段输入 + 保存，默认收在卡片右上角那个按钮后面。
 *
 * 「归到哪个模型」走带搜索的下拉（候选＝当前价表），但**不强制从列表里选** ——
 * 目录还没收录的新名字也得能填，填了就在下面提示它不参与计价。
 * 失败原因留在弹窗里（弹窗盖住了卡片上的 notice），成功由调用方关窗。
 */
import { useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { FieldRow } from '../../../components/FieldRow.tsx'
import { ModelPicker } from './ModelPicker.tsx'
import { isKnownModelName, type ModelOption } from '../model-search.ts'
import type { AliasDraft } from '../useAliasPanel.ts'
import type { SubmitOutcome } from '../usePricingPanel.ts'
import styles from '../../../styles/settings-section.module.css'

export interface AliasDialogProps {
  draft: AliasDraft
  setDraft: (next: AliasDraft) => void
  /** 价表里的模型 key，做「归到哪个模型」的下拉候选。 */
  options: readonly ModelOption[]
  busy: boolean
  onSubmit: () => Promise<SubmitOutcome>
  onClose: () => void
}

export function AliasDialog(props: AliasDialogProps): JSX.Element {
  const { draft, setDraft, options, busy, onSubmit, onClose } = props
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    const outcome = await onSubmit()
    // 成功时调用方已经关窗（本组件卸载），只剩失败原因要留在弹窗里。
    if (!outcome.ok) setError(outcome.reason)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="手工别名"
      closeLabel="关闭"
      description="把一个模型名并到另一个上：显示并成一行，计价也按它算。"
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={busy} onClick={() => { void submit() }}>保存</Button>
        </>
      )}
    >
      <div className={styles.form}>
        <FieldRow label="要并过来的模型">
          <Input
            className={styles.inputMd}
            placeholder="渠道/模型名，如 ds-hk/deepseek-flash"
            value={draft.key}
            onChange={(event) => { setDraft({ ...draft, key: event.currentTarget.value }) }}
          />
        </FieldRow>
        <FieldRow label="归到哪个模型" note="按它计价，也并成一行">
          <ModelPicker
            value={draft.canonical}
            options={options}
            disabled={busy}
            onChange={(next) => { setDraft({ ...draft, canonical: next }) }}
          />
        </FieldRow>
        {isKnownModelName(options, draft.canonical) ? null : (
          <p className={styles.sub}>价表里没有这个名字：只合并显示，不参与计价。</p>
        )}
        {error === '' ? null : <div className={styles.notice} data-kind="error" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}
