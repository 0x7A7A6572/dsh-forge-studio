/**
 * 记忆图谱的 option 构造：纯函数，不碰 DOM，能单测。
 *
 * 实体是骨架、记忆挂在上面的点；所以实体永远显示名字，记忆只在节点少时显示，
 * 否则几百个标签糊成一片，反而看不出结构。
 */
import type { EChartsCoreOption } from 'echarts/core'
import { MEMORY_EDGE_ORIGIN_LABELS, MEMORY_EDGE_RELATION_LABELS, MEMORY_ENTITY_KINDS, MEMORY_ENTITY_KIND_LABELS, MEMORY_KIND_LABELS } from '../../types.ts'
import type { MemoryEdge, MemoryEntity, MemoryRecord } from '../../types.ts'
import { entityMentionCounts, memoryLinkCounts } from './memory-model.ts'
import type { GraphPalette } from './graph-runtime.ts'

/** 记忆节点上限：再多力导向就拖不动了，只留关联最多的那批。 */
export const GRAPH_MAX_MEMORY_NODES = 500

/** 节点总数超过这个数就不画记忆标签。 */
const MEMORY_LABEL_LIMIT = 60

export interface MemoryGraphInput {
  readonly records: readonly MemoryRecord[]
  readonly entities: readonly MemoryEntity[]
  readonly edges: readonly MemoryEdge[]
}

export interface MemoryGraphBuild {
  readonly option: EChartsCoreOption
  readonly nodes: number
  readonly links: number
  /** 被数量上限省掉的记忆条数。 */
  readonly omitted: number
}

/** 节点 id 加类型前缀：记忆与实体的 id 各自独立，不加前缀会撞。 */
function nodeId(kind: 'memory' | 'entity', id: string): string {
  return (kind === 'memory' ? 'm:' : 'e:') + id
}

/** 记忆太多时只留关联最多的那批：孤立点看不出结构，先让位给 hub。 */
function pickRecords(
  records: readonly MemoryRecord[],
  linkCounts: Map<string, number>,
): readonly MemoryRecord[] {
  if (records.length <= GRAPH_MAX_MEMORY_NODES) return records
  return [...records]
    .sort((left, right) => (linkCounts.get(right.id) ?? 0) - (linkCounts.get(left.id) ?? 0))
    .slice(0, GRAPH_MAX_MEMORY_NODES)
}

/** 边的语义三组：记忆↔实体、记忆↔记忆、实体↔实体。 */
function edgeGroup(edge: MemoryEdge): keyof GraphPalette['edge'] {
  if (edge.from.kind !== edge.to.kind) return 'memoryEntity'
  return edge.from.kind === 'memory' ? 'memoryMemory' : 'entityEntity'
}

function memoryTip(record: MemoryRecord, links: number): string {
  return record.title + '<br/>' + MEMORY_KIND_LABELS[record.kind]
    + ' · 重要性 ' + record.importance + '/5 · 关联 ' + links + ' 条'
}

function entityTip(entity: MemoryEntity, mentions: number): string {
  const head = entity.name + '<br/>' + MEMORY_ENTITY_KIND_LABELS[entity.kind] + ' · 被提及 ' + mentions + ' 条'
  return entity.summary === '' ? head : head + '<br/>' + entity.summary
}

/** 建图前的准备：挑出要画的记忆，滤掉两端不全的边，把计数一次聚好。 */
function prepareGraph(input: MemoryGraphInput): {
  records: readonly MemoryRecord[]
  entities: readonly MemoryEntity[]
  edges: readonly MemoryEdge[]
  linkCounts: Map<string, number>
  mentionCounts: Map<string, number>
} {
  const linkCounts = memoryLinkCounts(input.edges)
  const records = pickRecords(input.records, linkCounts)
  const memoryIds = new Set<string>(records.map((record) => record.id))
  const entityIds = new Set<string>(input.entities.map((entity) => entity.id))
  // 两端都得在图里才画这条边：过滤后留下的节点之间不该出现断头线。
  const edges = input.edges.filter((edge) => {
    const fromInside = edge.from.kind === 'memory' ? memoryIds.has(edge.from.id) : entityIds.has(edge.from.id)
    const toInside = edge.to.kind === 'memory' ? memoryIds.has(edge.to.id) : entityIds.has(edge.to.id)
    return fromInside && toInside
  })
  return {
    records,
    entities: input.entities,
    edges,
    linkCounts,
    mentionCounts: entityMentionCounts(input.edges),
  }
}

/** 只报数量：视图要在这张图之外写「N 个节点 · N 条关联」，不必先拼出整份 option。 */
export function graphCounts(input: MemoryGraphInput): { nodes: number; links: number; omitted: number } {
  const prepared = prepareGraph(input)
  return {
    nodes: prepared.records.length + prepared.entities.length,
    links: prepared.edges.length,
    omitted: input.records.length - prepared.records.length,
  }
}

/** 记忆 + 实体 + 边 → 力导向图的 option（顺带回报实际画了多少）。 */
export function buildMemoryGraphOption(input: MemoryGraphInput, palette: GraphPalette): MemoryGraphBuild {
  const { records, entities, edges, linkCounts, mentionCounts } = prepareGraph(input)

  const categories = [
    { name: '记忆', itemStyle: { color: palette.memory } },
    ...MEMORY_ENTITY_KINDS.map((kind) => ({
      name: MEMORY_ENTITY_KIND_LABELS[kind],
      itemStyle: { color: palette.entity[kind] },
    })),
  ]
  const showMemoryLabels = records.length + entities.length <= MEMORY_LABEL_LIMIT

  const nodes = [
    ...records.map((record) => ({
      id: nodeId('memory', record.id),
      name: record.title,
      category: 0,
      symbol: 'roundRect',
      // 重要性 1-5 → 10.4-16：差一档看得出来，又不至于大到喧宾夺主。
      symbolSize: 9 + record.importance * 1.4,
      label: { show: showMemoryLabels },
      tip: memoryTip(record, linkCounts.get(record.id) ?? 0),
    })),
    ...entities.map((entity) => ({
      id: nodeId('entity', entity.id),
      name: entity.name,
      category: 1 + MEMORY_ENTITY_KINDS.indexOf(entity.kind),
      symbol: 'circle',
      // 被提及越多画得越大，上限 40 免得一个 hub 吃掉整张图。
      symbolSize: Math.min(40, 16 + (mentionCounts.get(entity.id) ?? 0) * 2),
      label: { show: true },
      tip: entityTip(entity, mentionCounts.get(entity.id) ?? 0),
    })),
  ]

  const links = edges.map((edge) => ({
    source: nodeId(edge.from.kind, edge.from.id),
    target: nodeId(edge.to.kind, edge.to.id),
    lineStyle: {
      color: palette.edge[edgeGroup(edge)],
      width: edge.origin === 'auto' ? 1 : 1.4,
      type: edge.origin === 'auto' ? 'dashed' : 'solid',
      opacity: 0.55,
    },
    tip: MEMORY_EDGE_RELATION_LABELS[edge.relation] + ' · ' + MEMORY_EDGE_ORIGIN_LABELS[edge.origin],
  }))

  const option: EChartsCoreOption = {
    backgroundColor: 'transparent',
    tooltip: {
      show: true,
      confine: true,
      backgroundColor: palette.surface,
      borderColor: palette.surface,
      borderWidth: 1,
      padding: [6, 10],
      extraCssText: 'border-radius: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);',
      textStyle: { color: palette.text, fontSize: 12 },
      formatter: (params: { name?: string; data?: { tip?: string } }) =>
        params.data?.tip ?? params.name ?? '',
    },
    legend: {
      // 压在图上的图例会被力导向的节点与标签盖住，一律放底部，series 再让出它的高度。
      bottom: 0,
      left: 'center',
      itemGap: 12,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.text, fontSize: 11 },
      data: categories.map((category) => category.name),
    },
    series: [{
      type: 'graph',
      layout: 'force',
      roam: true,
      draggable: true,
      top: 8,
      bottom: 46,
      data: nodes,
      links,
      categories,
      label: { position: 'right', fontSize: 11, color: palette.text },
      lineStyle: { curveness: 0.1, opacity: 0.6 },
      emphasis: {
        focus: 'adjacency',
        label: { show: true },
        lineStyle: { width: 2.4, opacity: 0.9 },
      },
      force: {
        repulsion: 320,
        gravity: 0.08,
        edgeLength: [50, 160],
        friction: 0.15,
        layoutAnimation: true,
      },
      scaleLimit: { min: 0.3, max: 4 },
    }],
  }

  return {
    option,
    nodes: nodes.length,
    links: links.length,
    omitted: input.records.length - records.length,
  }
}
