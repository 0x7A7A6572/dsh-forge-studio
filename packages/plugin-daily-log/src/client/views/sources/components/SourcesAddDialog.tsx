/** 新增数据源弹窗：DSH 工作区项目列表 + 手动路径表单。 */
import { Button, Input, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { SOURCE_TYPE_LABELS } from '../../../../types.ts'
import { ChannelChips } from '../../../components/ChannelChips.tsx'
import { DialogRoot } from '../../../components/DialogRoot.tsx'
import { useSourcesAddDialog } from './useSourcesAddDialog.ts'
import type { SourcesAddDialogProps } from './useSourcesAddDialog.ts'
import styles from '../../../styles/settings-section.module.css'

export function SourcesAddDialog(props: SourcesAddDialogProps): JSX.Element {
  const {
    path, label, author, candidates, wsError,
    setPath, setLabel, setAuthor, addManual, addCandidate,
  } = useSourcesAddDialog(props)

  return (
    <Modal
      open
      onClose={props.onClose}
      title="新增数据源"
      closeLabel="关闭"
      description="数据源 = 项目路径；报告会自动聚合该项目在 Git / DSH / Claude / Codex 各渠道的活动。"
      className={styles.dialogMd}
      footer={(
        <Button variant="outline" onClick={props.onClose}>完成</Button>
      )}
    >
      <DialogRoot>
        <div className={styles.field}>
          <div className={styles.cardHead}>
            <span className={styles.fieldLabel}>DSH 工作区项目</span>
            <span className={styles.itemDetail}>徽标 = 该项目在哪些渠道有活动</span>
          </div>
          <div className={styles.listBox}>
            {candidates === null
              ? <span className={styles.itemDetail}>读取中…</span>
              : candidates.length === 0
                ? <span className={styles.itemDetail}>暂无工作区项目。可在 DSH 工作区添加项目目录后回到本页，或用下方手动添加。</span>
                : candidates.map((c) => (
                  <div key={c.path} className={styles.item}>
                    <div className={styles.itemRow}>
                      <span className={styles.itemName} title={c.title}>{c.title}</span>
                      <Pill>{SOURCE_TYPE_LABELS[c.type]}</Pill>
                      <ChannelChips channels={c.channels} />
                      {c.added
                        ? <span className={styles.itemDetail}>已添加</span>
                        : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={props.busy}
                            onClick={() => { addCandidate(c) }}
                          >
                            添加
                          </Button>
                        )}
                    </div>
                    <div className={styles.itemRow}>
                      <span className={styles.itemPath} title={c.path}>{c.path}</span>
                      {c.detail !== undefined && <span className={styles.itemDetail}>{c.detail}</span>}
                    </div>
                  </div>
                ))}
            {wsError !== '' && <p className={styles.error} role="alert">{wsError}</p>}
          </div>
        </div>

        <div className={styles.divider}>或手动添加项目路径</div>

        <div className={styles.field}>
          <Input
            className={styles.grow}
            placeholder="项目绝对路径"
            value={path}
            onChange={(event) => { setPath(event.target.value) }}
          />
          <div className={styles.fieldRow}>
            <Input
              className={styles.grow}
              placeholder="显示名（可选）"
              value={label}
              onChange={(event) => { setLabel(event.target.value) }}
            />
            <Input
              className={styles.grow}
              placeholder="作者邮箱（可选，仅 Git 提交过滤）"
              value={author}
              onChange={(event) => { setAuthor(event.target.value) }}
            />
          </div>
          <div className={styles.addRow}>
            <Button
              size="sm"
              disabled={props.busy || path.trim() === ''}
              onClick={addManual}
            >
              添加该项目
            </Button>
            <span className={styles.itemDetail}>绝对路径；目录下含 .git 时按代码项目扫描提交</span>
          </div>
        </div>
      </DialogRoot>
    </Modal>
  )
}
