/** 新增 / 编辑模板弹窗：整段编辑 ↔ 两段预览。 */
import { Button, Input, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { DialogRoot } from '../../../components/DialogRoot.tsx'
import { useTemplateEditDialog } from './useTemplateEditDialog.ts'
import type { TemplateEditDialogProps } from './useTemplateEditDialog.ts'
import styles from '../../../styles/settings-section.module.css'

/** MarkdownText 本地化文案（模板预览用，引用稳定常量）。 */
const MD_LABELS = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

export function TemplateEditDialog(props: TemplateEditDialogProps): JSX.Element {
  const {
    name, setName, prompt, setPrompt, skeleton, setSkeleton,
    preview, setPreview, save, canSave,
  } = useTemplateEditDialog(props)

  return (
    <Modal
      open
      onClose={props.onClose}
      title={props.editing !== null ? '编辑模板' : '新增模板'}
      closeLabel="关闭"
      description=""
      className={styles.dialogMd}
      footer={(
        <>
          <Button variant="outline" onClick={props.onClose}>取消</Button>
          <Button disabled={!canSave} onClick={save}>
            {props.editing !== null ? '保存' : '创建'}
          </Button>
        </>
      )}
    >
      <DialogRoot>
        <div className={styles.fieldRow + ' ' + styles.fieldRowCenter}>
          <Input
            className={styles.grow}
            placeholder="模板名"
            value={name}
            onChange={(event) => { setName(event.target.value) }}
          />
          <div className={styles.seg}>
            <button
              type="button"
              className={preview ? styles.segBtn : styles.segBtn + ' ' + styles.segBtnActive}
              onClick={() => { setPreview(false) }}
            >
              编辑
            </button>
            <button
              type="button"
              className={preview ? styles.segBtn + ' ' + styles.segBtnActive : styles.segBtn}
              onClick={() => { setPreview(true) }}
            >
              预览
            </button>
          </div>
        </div>
        {preview
          ? (
            <>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>
                  指令段（可选）预览{prompt.trim() === '' ? ' —— 未填写' : ''}
                </span>
                {prompt.trim() !== '' && (
                  <div className={styles.preview}>
                    <MarkdownText text={prompt} labels={MD_LABELS} />
                  </div>
                )}
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>骨架段（必填）预览</span>
                <div className={styles.preview + ' ' + styles.previewTall}>
                  <MarkdownText text={skeleton} labels={MD_LABELS} />
                </div>
              </div>
            </>
          )
          : (
            <>
              <div className={styles.field}>
                <textarea
                  className={styles.textarea + ' ' + styles.textareaPrompt}
                  placeholder="指令段（可选）：给生成 AI 的额外撰写要求，如「按周维度组织，每周一个小节」"
                  value={prompt}
                  onChange={(event) => { setPrompt(event.target.value) }}
                />
              </div>
              <div className={styles.divider}>骨架段（报告章节结构，必填）</div>
              <textarea
                className={styles.textarea + ' ' + styles.textareaSkeleton}
                placeholder={'章节标题，示例：\n## 核心产出\n## 问题修复\n## 技术优化\n## 其他工作\n## 下一步计划'}
                value={skeleton}
                onChange={(event) => { setSkeleton(event.target.value) }}
              />
            </>
          )}
      </DialogRoot>
    </Modal>
  )
}
