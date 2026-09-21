/**
 * 工作报告 · 模板页：卡片栅格 + 卡片脚操作（编辑 / 设为默认 / 删除），
 * 末尾虚线「新增模板」；弹窗（编辑 / 预览两段式模板）走宿主 Modal 原语。
 */
import {
  IconCheckOutline14, IconEditOutline16, IconPlusOutline16, IconTrashOutline16, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { templateSummary } from '../../core/template-summary.ts'
import { AddButton } from '../../components/AddButton.tsx'
import { IconAction } from '../../components/IconAction.tsx'
import { useTemplatesView } from './useTemplatesView.ts'
import type { TemplatesViewProps } from './useTemplatesView.ts'
import { TemplateEditDialog } from './components/TemplateEditDialog.tsx'
import styles from '../../styles/settings-section.module.css'

/** 模板页。 */
export function TemplatesView(props: TemplatesViewProps): JSX.Element {
  const { dialog, openCreate, openEdit, closeDialog, setDefault, removeTemplate } = useTemplatesView(props)

  return (
    <div className={styles.pane}>
      {props.templates.length === 0
        ? <p className={styles.empty}>还没有模板。模板决定报告的章节结构：指令段可选，骨架段必填。</p>
        : (
          <>
            <h3 className={styles.groupHead}>模板</h3>
            <ul className={styles.cards}>
              {props.templates.map((t) => (
                <li key={t.id} className={styles.card}>
                  <div className={styles.cardBody}>
                    <div className={styles.cardHead}>
                      <span className={styles.cardName} title={t.name}>{t.name}</span>
                      {t.isBuiltin && <Pill>内置</Pill>}
                      {t.isDefault && <Pill active>默认</Pill>}
                    </div>
                    <span className={styles.cardDesc + ' ' + styles.clamp} title={templateSummary(t.content)}>
                      {templateSummary(t.content)}
                    </span>
                  </div>
                  {!t.isBuiltin && (
                    <div className={styles.cardFoot}>
                      <IconAction
                        label="编辑模板"
                        icon={<IconEditOutline16 size={16} />}
                        onClick={() => { openEdit(t) }}
                      />
                      {!t.isDefault && (
                        <IconAction
                          label="设为默认"
                          disabled={props.busy}
                          icon={<IconCheckOutline14 size={16} />}
                          onClick={() => { setDefault(t.id) }}
                        />
                      )}
                      <IconAction
                        label="删除模板"
                        danger
                        disabled={props.busy}
                        icon={<IconTrashOutline16 size={16} />}
                        onClick={() => { removeTemplate(t.id) }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      <AddButton
        label="新增模板"
        icon={<IconPlusOutline16 size={16} />}
        disabled={props.busy}
        onClick={openCreate}
      />
      {dialog !== null && (
        <TemplateEditDialog
          dailyLog={props.dailyLog}
          busy={props.busy}
          run={props.run}
          editing={dialog.editing}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}
