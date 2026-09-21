/**
 * 工作报告 · 数据源页。
 *
 * 布局：已添加项目做成卡片栅格（卡片脚 = 图标操作），栅格下方才是虚线「新增数据源」
 * 与会话库导入入口——新增位在卡片之后，读作「之后会长出东西的位置」。
 * 两个弹窗走宿主 Modal 原语（body portal），内容包 DialogRoot 以命中分区样式。
 */
import { IconPlusOutline16, IconTrashOutline16, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { SOURCE_TYPE_LABELS } from '../../../types.ts'
import { AddButton } from '../../components/AddButton.tsx'
import { IconAction } from '../../components/IconAction.tsx'
import { useSourcesView } from './useSourcesView.ts'
import type { SourcesViewProps } from './useSourcesView.ts'
import { SourcesAddDialog } from './components/SourcesAddDialog.tsx'
import { ImportProjectsDialog } from './components/ImportProjectsDialog.tsx'
import styles from '../../styles/settings-section.module.css'

/** 数据源页：已添加列表 + 两条添加入口。 */
export function SourcesView(props: SourcesViewProps): JSX.Element {
  const {
    addOpen, importOpen, openAdd, closeAdd, openImport, closeImport, removeSource, refresh,
  } = useSourcesView(props)

  return (
    <div className={styles.pane}>
      <AddButton
        label="新增数据源"
        icon={<IconPlusOutline16 size={16} />}
        disabled={props.busy}
        onClick={openAdd}
      />
      <div className={styles.addRow}>
        <button
          type="button"
          className={styles.textBtn + ' ' + styles.textAccent}
          onClick={openImport}
        >
          从 Claude Code / Codex 会话库导入项目
        </button>
      </div>
      {props.sources.length === 0
        ? (
          <p className={styles.empty}>
            还没有数据源。数据源 = 一个项目路径，报告会聚合该项目在 Git / DSH / Claude / Codex 各渠道的活动。
          </p>
        )
        : (
          <>
            <h3 className={styles.groupHead}>已添加项目</h3>
            <ul className={styles.cards}>
              {props.sources.map((s) => (
                <li key={s.id} className={styles.card}>
                  <div className={styles.cardBody}>
                    <div className={styles.cardHead}>
                      <span className={styles.cardName} title={s.label}>{s.label}</span>
                      <Pill>{SOURCE_TYPE_LABELS[s.type ?? 'other']}</Pill>
                      {s.author !== undefined && <span className={styles.chip}>@{s.author}</span>}
                    </div>
                    <span className={styles.cardPath} title={s.path}>{s.path}</span>
                  </div>
                  <div className={styles.cardFoot}>
                    <IconAction
                      label="删除数据源"
                      danger
                      disabled={props.busy}
                      icon={<IconTrashOutline16 size={16} />}
                      onClick={() => { removeSource(s.id) }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

      {addOpen && (
        <SourcesAddDialog
          dailyLog={props.dailyLog}
          busy={props.busy}
          run={props.run}
          sourcesLength={props.sources.length}
          onClose={closeAdd}
        />
      )}
      {importOpen && (
        <ImportProjectsDialog
          dailyLog={props.dailyLog}
          onClose={closeImport}
          onImported={refresh}
        />
      )}
    </div>
  )
}
