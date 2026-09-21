/**
 * 手工别名弹窗：两段输入 + 保存，默认收在卡片右上角那个按钮后面。
 *
 * 失败原因留在弹窗里（弹窗盖住了卡片上的 notice），成功由调用方关窗。
 */
import { useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { FieldRow } from '../../../components/FieldRow.tsx'
import type { AliasDraft, SubmitOutcome } from '../usePricingPanel.ts'
import styles from '../../../styles/settings-section.module.css'

export interface AliasDialogProps {
  draft: AliasDraft
  setDraft: (next: AliasDraft) => void
  busy: boolean
  onSubmit: () => Promise<SubmitOutcome>
  onClose: () => void
}

export function AliasDialog(props: AliasDialogProps): JSX.Element {
  const { draft, setDraft, busy, onSubmit, onClose } = props
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
      description="把改名的模型并到同一行显示。"
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={busy} onClick={() => { void submit() }}>保存</Button>
        </>
      )}
    >
      <div className={styles.form}>
        <FieldRow label="原始 id">
          <Input
            className={styles.inputMd}
            placeholder="provider/raw-model"
            value={draft.key}
            onChange={(event) => { setDraft({ ...draft, key: event.currentTarget.value }) }}
          />
        </FieldRow>
        <FieldRow label="canonical 模型">
          <Input
            className={styles.inputMd}
            placeholder="canonical-model"
            value={draft.canonical}
            onChange={(event) => { setDraft({ ...draft, canonical: event.currentTarget.value }) }}
          />
        </FieldRow>
        {error === '' ? null : <div className={styles.notice} data-kind="error" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}
