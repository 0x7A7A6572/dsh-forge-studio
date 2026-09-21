/** 会话库一键导入弹窗：扫描结果做成左右穿梭框。 */
import { Button, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { SOURCE_TYPE_LABELS } from '../../../../types.ts'
import type { ProjectCandidate } from '../../../../types.ts'
import { ChannelChips } from '../../../components/ChannelChips.tsx'
import { DialogRoot } from '../../../components/DialogRoot.tsx'
import { useImportProjectsDialog } from './useImportProjectsDialog.ts'
import type { ImportProjectsDialogProps } from './useImportProjectsDialog.ts'
import styles from '../../../styles/settings-section.module.css'

/** 一行候选：标题行（名 + 类型 + 渠道 + 尾随操作）+ 路径行。 */
function CandidateRow(props: { candidate: ProjectCandidate; trailing: JSX.Element }): JSX.Element {
  const c = props.candidate
  return (
    <div className={styles.item}>
      <div className={styles.itemRow}>
        <span className={styles.itemName} title={c.title}>{c.title}</span>
        <Pill>{SOURCE_TYPE_LABELS[c.type]}</Pill>
        <ChannelChips channels={c.channels} />
        {props.trailing}
      </div>
      <div className={styles.itemRow}>
        <span className={styles.itemPath} title={c.path}>{c.path}</span>
        {c.detail !== undefined && <span className={styles.itemDetail}>{c.detail}</span>}
      </div>
    </div>
  )
}

export function ImportProjectsDialog(props: ImportProjectsDialogProps): JSX.Element {
  const {
    discovered, left, right, error, result, busy,
    moveToRight, moveToLeft, pickAll, clearAll, importSelected,
  } = useImportProjectsDialog(props)

  return (
    <Modal
      open
      onClose={props.onClose}
      title="导入 Claude Code / Codex 项目"
      closeLabel="关闭"
      description="扫描会话库，按会话工作目录归集为项目；已在数据源里的自动跳过。"
      className={styles.dialogLg}
      footer={(
        <>
          <Button variant="outline" onClick={props.onClose}>关闭</Button>
          <Button disabled={busy || right.length === 0} onClick={importSelected}>
            {busy ? '导入中…' : '导入 ' + right.length + ' 个项目'}
          </Button>
        </>
      )}
    >
      <DialogRoot>
        {discovered === null
          ? <span className={styles.itemDetail}>正在扫描 ~/.claude/projects 与 ~/.codex/sessions…（会话多时需数秒）</span>
          : (
            <>
              <div className={styles.transfer}>
                <div className={styles.transferPane}>
                  <div className={styles.transferHead}>
                    <span className={styles.fieldLabel}>可导入（{left.length}）</span>
                    {left.length > 0 && (
                      <button type="button" className={styles.textBtn} onClick={pickAll}>全部加入 →</button>
                    )}
                  </div>
                  <div className={styles.listBox}>
                    {left.length === 0
                      ? (
                        <span className={styles.itemDetail}>
                          {discovered.length === 0 ? '没有发现会话项目（对应工具可能尚未使用）' : '没有可导入的新项目'}
                        </span>
                      )
                      : left.map((c) => (
                        <CandidateRow
                          key={c.path}
                          candidate={c}
                          trailing={<Button size="sm" variant="outline" onClick={() => { moveToRight(c) }}>加入</Button>}
                        />
                      ))}
                  </div>
                </div>
                <div className={styles.transferPane}>
                  <div className={styles.transferHead}>
                    <span className={styles.fieldLabel}>待导入（{right.length}）</span>
                    {right.length > 0 && (
                      <button type="button" className={styles.textBtn} onClick={clearAll}>← 全部退回</button>
                    )}
                  </div>
                  <div className={styles.listBox}>
                    {right.length === 0
                      ? <span className={styles.itemDetail}>从左侧选择要导入的项目</span>
                      : right.map((c) => (
                        <CandidateRow
                          key={c.path}
                          candidate={c}
                          trailing={<Button size="sm" variant="outline" onClick={() => { moveToLeft(c) }}>退回</Button>}
                        />
                      ))}
                  </div>
                </div>
              </div>
              {error !== '' && <p className={styles.error} role="alert">{error}</p>}
              {result !== '' && <p className={styles.note}>{result}</p>}
            </>
          )}
      </DialogRoot>
    </Modal>
  )
}
