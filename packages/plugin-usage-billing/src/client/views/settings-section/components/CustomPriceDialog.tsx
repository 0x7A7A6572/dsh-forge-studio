/**
 * 自定义单价弹窗。
 *
 * 表单默认收起：卡片上只留一个入口按钮，点开才录入 —— 六行输入常驻会把「价表」这块
 * 撑成一张表单，而录入是低频动作。校验失败的原因留在弹窗里（载入失败/不合法），
 * 底部卡片那条 notice 在弹窗打开时看不见。
 */
import { useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Currency } from '../../../../types.ts'
import { FieldRow } from '../../../components/FieldRow.tsx'
import type { Draft, SubmitOutcome } from '../usePricingPanel.ts'
import styles from '../../../styles/settings-section.module.css'

export interface CustomPriceDialogProps {
  draft: Draft
  setDraft: (next: Draft) => void
  busy: boolean
  onSubmit: () => Promise<SubmitOutcome>
  onClose: () => void
}

/** 四个单价输入长得一样，抽一个渲染函数（纯排版，不含状态）。 */
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

export function CustomPriceDialog(props: CustomPriceDialogProps): JSX.Element {
  const { draft, setDraft, busy, onSubmit, onClose } = props
  const [error, setError] = useState('')
  /** 草稿的整段改写：`setDraft` 由 hook 持有，视图只做字段级合并。 */
  const patch = (part: Partial<Draft>): void => { setDraft({ ...draft, ...part }) }
  const submit = async (): Promise<void> => {
    const outcome = await onSubmit()
    // 成功时调用方已经关窗（本组件卸载），只剩失败原因要留在弹窗里。
    if (!outcome.ok) setError(outcome.reason)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="自定义单价"
      closeLabel="关闭"
      description="覆盖目录价，按每百万 token 计。"
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={busy} onClick={() => { void submit() }}>保存</Button>
        </>
      )}
    >
      <div className={styles.form}>
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
        <FieldRow label="币种">
          <select
            className={styles.select}
            value={draft.currency}
            onChange={(event) => { patch({ currency: event.currentTarget.value as Currency }) }}
          >
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
          </select>
        </FieldRow>
        {error === '' ? null : <div className={styles.notice} data-kind="error" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}
