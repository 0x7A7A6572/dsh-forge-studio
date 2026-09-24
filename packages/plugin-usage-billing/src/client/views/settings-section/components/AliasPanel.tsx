/**
 * 「其他配置」页签里的手工别名卡片：把改名的模型并到同一个模型上的列表 + 绑定入口。
 *
 * 版式：一张可折的卡片（默认收起 —— 别名是一次性设置，平时列表留着只会拉长页签），
 * 卡头的「添加别名」在收起时仍然可点。录入走 AliasDialog，不常驻表单。
 *
 * 状态不在这里：`useAliasPanel` 由 SettingsSection 调一次；候选（当前价表 key）从价表
 * hook 的结果里取，本组件只画。
 */
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { Card } from '../../../components/Card.tsx'
import { AliasDialog } from './AliasDialog.tsx'
import type { AliasState } from '../useAliasPanel.ts'
import type { ModelOption } from '../model-search.ts'
import type { PriceRow } from '../usePricingPanel.ts'
import styles from '../../../styles/settings-section.module.css'

/** 价目行 → 别名弹窗的候选（与价表页共用同一份数据，不重复拉）。 */
function optionsOf(rows: readonly PriceRow[]): ModelOption[] {
  return rows.map((row) => ({ key: row.key, custom: row.custom }))
}

export function AliasPanel(props: { state: AliasState; rows: readonly PriceRow[] }): JSX.Element {
  const { aliases, aliasDraft, setAliasDraft, busy, msg, bindAlias, unbindAlias } = props.state
  /** 弹窗开合与卡片开合：纯界面状态，留在视图层。 */
  const [aliasOpen, setAliasOpen] = useState(false)
  const [open, setOpen] = useState(false)

  return (
    <>
      <Card
        title="手工别名"
        desc="把改名的模型并到同一个模型上：显示并成一行、计价也按它算；每个渠道各绑一次，账本不动。"
        collapsible
        open={open}
        onToggle={() => { setOpen((previous) => !previous) }}
        extra={(
          <Button
            variant="outline" size="sm" disabled={busy} icon={<Plus size={14} />}
            onClick={() => { setAliasOpen(true) }}
          >
            添加别名
          </Button>
        )}
      >
        {msg === '' ? null : <div className={styles.notice} data-kind="info" role="status">{msg}</div>}
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

      {/* 弹窗 portal 到 body，摆在 Fragment 里不会切断分节线。 */}
      {aliasOpen ? (
        <AliasDialog
          draft={aliasDraft}
          setDraft={setAliasDraft}
          options={optionsOf(props.rows)}
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
