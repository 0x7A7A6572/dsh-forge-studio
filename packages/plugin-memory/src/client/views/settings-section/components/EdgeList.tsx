/** 本页面专属零件：某条记忆的关联列表（关系 + 另一端 + 来源 + 备注 + 断开）。 */

import { Button, IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { nodeKindLabel, entityKindClass } from '../../../core/memory-model.ts'
import type { GraphLocateTarget } from '../../../core/memory-section-types.ts'
import { MEMORY_EDGE_ORIGIN_LABELS, MEMORY_EDGE_RELATION_LABELS } from '../../../../types.ts'
import type { MemoryEdge, MemoryGraphNode } from '../../../../types.ts'
import styles from '../../../styles/settings-section.module.css'

/** 关联列表：关系标签 + 另一端节点（记忆可点进去 / 实体按类别着色）+ 来源 + 备注 + 定位 + 断开。 */
export function EdgeList(props: {
  edges: readonly MemoryEdge[]
  related: readonly { readonly edgeId: string; readonly node: MemoryGraphNode }[]
  disabled?: boolean
  onJump: (id: string) => void
  /** 在图谱里点亮这一端的节点。 */
  onLocate: (target: GraphLocateTarget) => void
  onUnlink: (edge: MemoryEdge) => void
}): JSX.Element {
  const relatedByEdge = new Map<string, MemoryGraphNode>(
    props.related.map((item) => [item.edgeId, item.node] as const),
  )
  return (
    <div className={styles.edgeList}>
      {props.edges.map((edge) => {
        const node = relatedByEdge.get(edge.id)
        return (
          <div className={styles.edgeItem} key={edge.id}>
            <span className={styles.edgeRelation}>{MEMORY_EDGE_RELATION_LABELS[edge.relation]}</span>
            {node === undefined ? (
              <span className={styles.rawMeta}>端点已删除</span>
            ) : node.ref.kind === 'memory' ? (
              <button
                type="button"
                className={`${styles.edgeNode} ${styles.edgeJump}`}
                title="查看这条记忆"
                onClick={() => { props.onJump(node.ref.id) }}
              >
                {node.label}
              </button>
            ) : (
              <span className={styles.edgeNode}>
                <span className={`${styles.entityBadge} ${styles[entityKindClass(node.kind)]}`}>{nodeKindLabel(node)}</span>
                {node.label}
              </span>
            )}
            <span className={styles.rawMeta}>{MEMORY_EDGE_ORIGIN_LABELS[edge.origin]}</span>
            {edge.note !== '' && <span className={styles.edgeNote}>{edge.note}</span>}
            <Button
              variant="ghost" size="sm"
              disabled={props.disabled === true || node === undefined}
              icon={<IconBranchOutline16 size={14} />}
              title="在图谱里定位"
              onClick={() => {
                if (node === undefined) return
                props.onLocate({
                  kind: node.ref.kind,
                  id: node.ref.id,
                  scope: node.scope,
                  projectPath: node.projectPath,
                })
              }}
            />
            <Button
              variant="ghost" size="sm" disabled={props.disabled === true}
              title="断开这条关联"
              onClick={() => { props.onUnlink(edge) }}
            >
              断开
            </Button>
          </div>
        )
      })}
    </div>
  )
}
