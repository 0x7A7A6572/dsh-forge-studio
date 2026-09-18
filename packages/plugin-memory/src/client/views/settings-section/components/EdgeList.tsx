/** 本页面专属零件：某条记忆的关联列表（关系 + 另一端 + 来源 + 备注 + 断开）。 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { nodeKindLabel, entityKindClass } from '../../../core/memory-model.ts'
import { MEMORY_EDGE_ORIGIN_LABELS, MEMORY_EDGE_RELATION_LABELS } from '../../../../types.ts'
import type { MemoryEdge, MemoryGraphNode } from '../../../../types.ts'

/** 关联列表：关系标签 + 另一端节点（记忆可点进去 / 实体按类别着色）+ 来源 + 备注 + 断开。 */
export function EdgeList(props: {
  edges: readonly MemoryEdge[]
  related: readonly { readonly edgeId: string; readonly node: MemoryGraphNode }[]
  disabled?: boolean
  onJump: (id: string) => void
  onUnlink: (edge: MemoryEdge) => void
}): JSX.Element {
  const relatedByEdge = new Map<string, MemoryGraphNode>(
    props.related.map((item) => [item.edgeId, item.node] as const),
  )
  return (
    <div className="mem-edge-list">
      {props.edges.map((edge) => {
        const node = relatedByEdge.get(edge.id)
        return (
          <div className="mem-edge-item" key={edge.id}>
            <span className="mem-edge-relation">{MEMORY_EDGE_RELATION_LABELS[edge.relation]}</span>
            {node === undefined ? (
              <span className="mem-raw-meta">端点已删除</span>
            ) : node.ref.kind === 'memory' ? (
              <button
                type="button"
                className="mem-edge-node mem-edge-jump"
                title="查看这条记忆"
                onClick={() => { props.onJump(node.ref.id) }}
              >
                {node.label}
              </button>
            ) : (
              <span className="mem-edge-node">
                <span className={'mem-entity-badge ' + entityKindClass(node.kind)}>{nodeKindLabel(node)}</span>
                {node.label}
              </span>
            )}
            <span className="mem-raw-meta">{MEMORY_EDGE_ORIGIN_LABELS[edge.origin]}</span>
            {edge.note !== '' && <span className="mem-edge-note">{edge.note}</span>}
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
