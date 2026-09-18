/**
 * 记忆分区的纯模型层：标签映射、格式化函数、表单选项表，以及不碰 IO 的派生计算。
 *
 * 不 import react，也不碰 remote —— 全是 (输入) => 输出，可脱离 DOM 直接验。
 * 选项表放这里是因为它们跟 src/types.ts 的枚举一一对应，改枚举时一眼能看见全貌。
 */

import type { MemoryTab } from './memory-section-types.ts'
import { MEMORY_EDGE_RELATION_LABELS, MEMORY_EDGE_RELATIONS, MEMORY_ENTITY_KINDS, MEMORY_ENTITY_KIND_LABELS, MEMORY_IMPORTANCE_LABELS, MEMORY_KINDS, MEMORY_KIND_LABELS, MEMORY_SCOPES } from '../../types.ts'
import type { MemoryEdge, MemoryEntityKind, MemoryGraphNode, MemoryKind, MemoryNodeKind, MemoryScope } from '../../types.ts'

/** 页签顺序（记忆两个作用域在前，实体在后）。 */
export const MEMORY_TABS: readonly MemoryTab[] = ['global', 'project', 'entity']

export const TAB_LABELS: Record<MemoryTab, string> = { global: '全局记忆', project: '项目记忆', entity: '实体' }

export function errText(error: unknown): string {
  if (error === undefined || error === null) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

/** 时间戳 → 本地可读时间（详情与审计共用）。 */
export function timeText(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '—'
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** 耗时展示：不足 1 秒给毫秒。 */
export function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'
}

/** 原文留档来源标签。 */
export const ORIGIN_LABELS: Record<string, string> = { import: '导入', capture: '对话提炼', manual: '手工' }

/** 后台模型调用的用途标签（审计列表用）。 */
export const AUDIT_KIND_LABELS: Record<string, string> = {
  capture: '对话提炼',
  extract: '原文抽取',
  entity: '实体抽取',
  judge: '写入判定',
}

/** 一条记忆的来源标签（面板详情用）。 */
export function sourceLabel(source: string): string {
  if (source === 'agent') return '模型工具'
  if (source === 'user') return '面板手工'
  if (source === 'capture') return '自动提炼'
  if (source === 'import') return '导入'
  return source
}

/**
 * 别名输入 → 数组：按 / 、 , ， 分隔，去掉空项与重复项。
 * 刻意不把空格当分隔符 —— 别名可以本身就是多个词（DeepSeek Harness）。
 */
export function parseAliases(text: string): string[] {
  const parts = text
    .split(/[/、,，]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
  return [...new Set(parts)]
}

/** 关联视图里节点的类别标签：实体走实体类别，记忆走记忆分类。 */
export function nodeKindLabel(node: MemoryGraphNode): string {
  if (node.ref.kind === 'entity') return MEMORY_ENTITY_KIND_LABELS[node.kind as MemoryEntityKind] ?? node.kind
  return MEMORY_KIND_LABELS[node.kind as MemoryKind] ?? node.kind
}

/** 实体类别徽标的着色类名（类别未知时退回 other，不落空类）。 */
export function entityKindClass(kind: string): string {
  return MEMORY_ENTITY_KINDS.includes(kind as MemoryEntityKind) ? 'mem-entity-' + kind : 'mem-entity-other'
}

/** 每条记忆的关联数：端点 kind === 'memory' 的两侧都算一条（一次 listEdges 的结果在内存里聚合）。 */
export function memoryLinkCounts(edges: readonly MemoryEdge[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const edge of edges) {
    for (const node of [edge.from, edge.to]) {
      if (node.kind !== 'memory') continue
      counts.set(node.id, (counts.get(node.id) ?? 0) + 1)
    }
  }
  return counts
}

/** 每个实体被多少条记忆提及（同一条记忆只算一次，按记忆去重）。 */
export function entityMentionCounts(edges: readonly MemoryEdge[]): Map<string, number> {
  const seen = new Map<string, Set<string>>()
  for (const edge of edges) {
    const from = edge.from
    const to = edge.to
    const memorySide = from.kind === 'memory' ? from : to.kind === 'memory' ? to : undefined
    const entitySide = from.kind === 'entity' ? from : to.kind === 'entity' ? to : undefined
    if (memorySide === undefined || entitySide === undefined) continue
    const ids = seen.get(entitySide.id) ?? new Set<string>()
    ids.add(memorySide.id)
    seen.set(entitySide.id, ids)
  }
  return new Map([...seen].map(([id, ids]) => [id, ids.size]))
}

/** 与某个实体相连的记忆 id（按边的顺序去重），用于「实体 → 关联记忆」映射。 */
export function linkedMemoryIds(edges: readonly MemoryEdge[], entityId: string): string[] {
  const ids: string[] = []
  for (const edge of edges) {
    const entitySide = edge.from.kind === 'entity' && edge.from.id === entityId
      ? edge.from
      : edge.to.kind === 'entity' && edge.to.id === entityId ? edge.to : undefined
    if (entitySide === undefined) continue
    const other = edge.from === entitySide ? edge.to : edge.from
    if (other.kind !== 'memory') continue
    if (!ids.includes(other.id)) ids.push(other.id)
  }
  return ids
}

export const SCOPE_LABELS: Record<MemoryScope, string> = { global: '全局记忆', project: '项目记忆' }

/**
 * 「更多」下拉里的次要操作。
 * 工具条只留三个位置：新增（唯一的新建入口）、沉淀（看原文与后台调用）、更多。
 * 整理 / 重建关联 / 复制导出 / 导入 / 重置都是维护类操作，低频且各占一个按钮宽度，
 * 收进下拉后工具条从 7 个按钮缩到 3 个。
 */
export const MORE_ACTIONS = [
  { id: 'tidy', label: '整理（合并重复）' },
  { id: 'rebuild', label: '重建关联' },
  { id: 'copy', label: '复制导出' },
  { id: 'import', label: '导入' },
  { id: 'reset', label: '重置当前页签' },
] as const

/** 「更多」里的一项动作 id。 */
export type MemoryMoreAction = (typeof MORE_ACTIONS)[number]['id']

/** 分段组按钮的选项：短枚举一律用组按钮，不用下拉（少一次点击、也不用展开面板）。 */
export const SCOPE_OPTIONS = MEMORY_SCOPES.map((scope) => ({ value: scope, label: SCOPE_LABELS[scope] }))

export const KIND_OPTIONS = MEMORY_KINDS.map((kind) => ({ value: kind, label: MEMORY_KIND_LABELS[kind] }))

/** 实体类别选项（与记忆分类共用同一套组按钮语言）。 */
export const ENTITY_KIND_OPTIONS = MEMORY_ENTITY_KINDS.map((kind) => ({ value: kind, label: MEMORY_ENTITY_KIND_LABELS[kind] }))

/** 边的目标端点类型（记忆 / 实体）。 */
export const NODE_KIND_OPTIONS: readonly { value: MemoryNodeKind; label: string }[] = [
  { value: 'memory', label: '记忆' },
  { value: 'entity', label: '实体' },
]

/** 关系选项：9 种关系全列 + 中文标签（下拉用，位置不够时不挤成一行按钮）。 */
export const RELATION_OPTIONS = MEMORY_EDGE_RELATIONS.map((relation) => ({
  value: relation,
  label: MEMORY_EDGE_RELATION_LABELS[relation],
}))

/** 重要性 5 档：中文等级名 + 一句话说明（滑杆下方显示当前档）。 */
export const IMPORTANCE_LEVELS = [
  { value: 1, label: MEMORY_IMPORTANCE_LABELS[0], desc: '边缘信息，几乎不会用到' },
  { value: 2, label: MEMORY_IMPORTANCE_LABELS[1], desc: '有点用，但不常用' },
  { value: 3, label: MEMORY_IMPORTANCE_LABELS[2], desc: '一般偏好与事实' },
  { value: 4, label: MEMORY_IMPORTANCE_LABELS[3], desc: '影响多数对话的约定' },
  { value: 5, label: MEMORY_IMPORTANCE_LABELS[4], desc: '每次对话都要遵守' },
] as const

/** 重要性 1-5 的档位（节点滑杆用）。 */
export const IMPORTANCE_STEPS = [1, 2, 3, 4, 5] as const

/** 提炼间隔档位：覆盖 1-20，但只给有意义的停点。 */
export const CAPTURE_EVERY_STEPS = [1, 2, 3, 5, 8, 10, 15, 20] as const

/** 转录窗口轮数档位。 */
export const CAPTURE_TURNS_STEPS = [2, 4, 6, 8, 12, 16, 24] as const

/** 转录字符上限档位。 */
export const CAPTURE_CHARS_STEPS = [1000, 2000, 4000, 6000, 8000, 12000] as const

/** 第 N 档的重要性等级（越界回落到「普通」）。 */
export function importanceLevelAt(value: number) {
  return IMPORTANCE_LEVELS[value - 1] ?? IMPORTANCE_LEVELS[2]
}

export const IMPORT_MODE_OPTIONS = [
  { value: 'merge' as const, label: '合并', title: '按标题去重，已有的就地更新' },
  { value: 'replace' as const, label: '覆盖', title: '先清空当前作用域再导入' },
]
