/**
 * 记忆图谱：力导向图的画布宿主。
 *
 * 拿不到 canvas 或 echarts 加载失败时退成一句说明 —— 空白画布比不画更难查。
 */
import type { MemoryEdge, MemoryEntity, MemoryRecord } from '../../types.ts'
import { buildMemoryGraphOption, graphCounts } from '../core/graph-option.ts'
import { graphPalette } from '../core/graph-runtime.ts'
import { useGraphHost } from '../hooks/useGraphHost.ts'
import styles from '../styles/settings-section.module.css'

export interface MemoryGraphProps {
  readonly records: readonly MemoryRecord[]
  readonly entities: readonly MemoryEntity[]
  readonly edges: readonly MemoryEdge[]
  /** 点记忆节点：外边开详情；图谱自己不关（详情盖在它上面）。 */
  readonly onOpenMemory: (record: MemoryRecord) => void
}

export function MemoryGraph(props: MemoryGraphProps): JSX.Element {
  const input = { records: props.records, entities: props.entities, edges: props.edges }
  const counts = graphCounts(input)
  const byId = new Map(props.records.map((record) => ['m:' + record.id, record]))
  const { hostRef, mode } = useGraphHost(
    // 颜色每次 build 现读图谱容器：主题变量挂在 body 上，切主题时宿主会重跑这里。
    (host) => buildMemoryGraphOption(input, graphPalette(host)).option,
    (params) => {
      // 实体节点点了不开详情（实体没有独立弹窗），要看得回列表页签。
      const record = params.data?.id === undefined ? undefined : byId.get(params.data.id)
      if (record !== undefined) props.onOpenMemory(record)
    },
  )

  const meta = counts.nodes + ' 个节点 · ' + counts.links + ' 条关联'
    + (counts.omitted > 0 ? ' · 已省略 ' + counts.omitted + ' 条记忆' : '')

  return (
    <>
      <p className={styles.graphMeta}>{meta}</p>
      {mode === 'unsupported' ? (
        <p className={styles.graphEmpty}>当前环境无法显示图谱，可回到列表看关联。</p>
      ) : (
        <div ref={hostRef} className={styles.graphHost} role="img" aria-label="记忆图谱" />
      )}
    </>
  )
}
