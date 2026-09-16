/**
 * 记忆 —— dsh 设置面板里的一级分区（对齐 Agent 预设分区的布局语言）。
 *
 * 结构：标题 + 引言 → 记忆开关块（生成对话记忆 / 自动注入 / 注入条数与门槛）
 * → 「管理记忆」工具条（新增 / 整理 / 复制 / 重置 / 导入 / 编辑）
 * → 页签（全局记忆 / 项目记忆 / 实体，带计数）→ 记忆条目列表（可直接改正文）
 * → 详情弹窗里的「关联」区块（wiki 图层：实体 + 边，可连边 / 断边）。
 *
 * 读写全部走 Typert remote（ctx.remote.memory.*）；开关写的是设置命名空间的用户层，
 * 与插件设置卡片同源，改完即时生效。
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Button,
  IconArchiveOutline20,
  IconChecklistOutline14,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconListPenOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
  Input,
  Modal,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ChevronDown } from 'lucide-react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryRemote } from '../core/remote.ts'
import { ScaleSlider } from '../components/scale-slider.tsx'
import { pluginVersion } from '../../version.ts'
import {
  IMPORT_PROMPT_TEXT,
  MEMORY_CONFIG_BASE,
  MEMORY_EDGE_ORIGIN_LABELS,
  MEMORY_EDGE_RELATION_LABELS,
  MEMORY_EDGE_RELATIONS,
  MEMORY_ENTITY_KINDS,
  MEMORY_ENTITY_KIND_LABELS,
  MEMORY_IMPORTANCE_LABELS,
  MEMORY_KINDS,
  MEMORY_KIND_LABELS,
  MEMORY_SCOPES,
  importanceLabel,
} from '../../types.ts'
import type {
  MemoryAuditEntry,
  MemoryConfig,
  MemoryConflict,
  MemoryEdge,
  MemoryEdgeRelation,
  MemoryEntity,
  MemoryEntityKind,
  MemoryGraphNode,
  MemoryId,
  MemoryKind,
  MemoryNeighborhood,
  MemoryNodeKind,
  MemoryProjectSummary,
  MemoryRawDocument,
  MemoryRawId,
  MemoryRecord,
  MemoryScope,
  MemoryStats,
} from '../../types.ts'

/** 注册侧注入的业务面（见 src/client/index.ts）。 */
export interface MemorySectionInjected {
  memory: MemoryRemote
}

/** 分区组件完整 props：设置外壳 owner props + 插件注入面。 */
export type MemorySectionProps =
  PropsRuntime<'settings.section'> & InjectFace<MemorySectionInjected>

/** 页签：两个记忆作用域 + wiki 图层的实体目录。 */
export type MemoryTab = MemoryScope | 'entity'

/** 页签顺序（记忆两个作用域在前，实体在后）。 */
export const MEMORY_TABS: readonly MemoryTab[] = ['global', 'project', 'entity']

const TAB_LABELS: Record<MemoryTab, string> = { global: '全局记忆', project: '项目记忆', entity: '实体' }

/** 编辑中的草稿（id 为 null 表示新增）。 */
interface Draft {
  id: string | null
  title: string
  /** 一行摘要（列表卡与关联视图用）。 */
  summary: string
  /** 别名原文；保存时按 parseAliases 拆成数组。 */
  aliases: string
  content: string
  kind: MemoryKind
  importance: number
  scope: MemoryScope
  projectPath: string
}

/** 实体草稿（id 为 null 表示新建）。 */
interface EntityDraft {
  id: string | null
  name: string
  kind: MemoryEntityKind
  aliases: string
  summary: string
}

/** 详情弹窗里「连一条边」的表单。 */
interface LinkDraft {
  toKind: MemoryNodeKind
  toId: string
  relation: MemoryEdgeRelation
  note: string
}

function errText(error: unknown): string {
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

const SCOPE_LABELS: Record<MemoryScope, string> = { global: '全局记忆', project: '项目记忆' }

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

const IMPORT_MODE_OPTIONS = [
  { value: 'merge' as const, label: '合并', title: '按标题去重，已有的就地更新' },
  { value: 'replace' as const, label: '覆盖', title: '先清空当前作用域再导入' },
]

/**
 * 弹窗内的操作结果提示。
 * run() 把错误写进分区正文，而弹窗是 portal 覆盖在上面的 —— 不在这里再显示一份，
 * 弹窗里的失败就完全看不见，用户视角就是「点了没反应」。
 */
export function ModalFeedback(props: { error: string; notice: string }) {
  return (
    <>
      {props.error !== '' && <span className="mem-error" role="alert">{props.error}</span>}
      {props.notice !== '' && <span className="mem-notice">{props.notice}</span>}
    </>
  )
}

/** 一个开关行：标题 + 说明 + 右侧滑动开关（role=switch，键盘可达）。 */
function SwitchRow(props: {
  title: string
  desc: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="mem-row">
      <div className="mem-row-copy">
        <span className="mem-row-title">{props.title}</span>
        <p className="mem-row-desc">{props.desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.title}
        disabled={props.disabled === true}
        className={props.checked ? 'mem-switch mem-switch-on' : 'mem-switch'}
        onClick={() => { props.onChange(!props.checked) }}
      >
        <span className="mem-switch-knob" />
      </button>
    </div>
  )
}

/** 分段组按钮：给「作用域 / 分类 / 重要性」这类短枚举用，替代下拉。 */
export function Segmented<T extends string | number>(props: {
  label: string
  value: T
  options: readonly { value: T; label: string; title?: string }[]
  disabled?: boolean
  onChange: (next: T) => void
}): JSX.Element {
  return (
    <div className="mem-seg-row">
      <span className="mem-seg-label">{props.label}</span>
      <div className="mem-seg" role="radiogroup" aria-label={props.label}>
        {props.options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === props.value}
            title={option.title ?? option.label}
            disabled={props.disabled === true}
            className={option.value === props.value ? 'mem-seg-btn mem-seg-on' : 'mem-seg-btn'}
            onClick={() => { props.onChange(option.value) }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 草稿表单（新增 / 编辑共用，渲染在弹窗里）。模块级组件，便于单测直接渲染。 */
export function MemoryDraftForm(props: {
  draft: Draft
  disabled?: boolean
  onChange: (next: Draft) => void
}): JSX.Element {
  const current = props.draft
  const setDraft = props.onChange
  
    return (
      <div className="mem-modal-body" data-dsh-memory-ui="">
        <div className="mem-draft-form">
          <Input
            value={current.title}
            placeholder="标题（同作用域下同名会自动合并）"
            onChange={(event) => { setDraft({ ...current, title: event.currentTarget.value }) }}
          />
          <Input
            value={current.summary}
            placeholder="摘要（可选，一行说清这条讲什么）"
            onChange={(event) => { setDraft({ ...current, summary: event.currentTarget.value }) }}
          />
          <Input
            value={current.aliases}
            placeholder="别名（可选，用 / 、 或逗号分隔）"
            onChange={(event) => { setDraft({ ...current, aliases: event.currentTarget.value }) }}
          />
          <Segmented
            label="作用域"
            value={current.scope}
            options={SCOPE_OPTIONS}
            onChange={(scope) => {
              setDraft({ ...current, scope, projectPath: scope === 'project' ? current.projectPath : '' })
            }}
          />
          {current.scope === 'project' && (
            <div className="mem-field-row">
              <span>工作区目录</span>
              <Input
                list="mem-project-options"
                value={current.projectPath}
                placeholder="工作区绝对路径"
                onChange={(event) => { setDraft({ ...current, projectPath: event.currentTarget.value }) }}
              />
            </div>
          )}
          <Segmented
            label="分类"
            value={current.kind}
            options={KIND_OPTIONS}
            onChange={(kind) => { setDraft({ ...current, kind }) }}
          />
          <div className="mem-seg-row">
            <span className="mem-seg-label">重要性</span>
            <ScaleSlider
              label="重要性"
              value={current.importance}
              steps={IMPORTANCE_STEPS}
              disabled={props.disabled === true}
              describe={(value) => {
                const level = importanceLevelAt(value)
                return <><b>{level.label}</b>{' · '}{level.desc}</>
              }}
              valueText={(value) => {
                const level = importanceLevelAt(value)
                return level.label + '（' + value + '/5）· ' + level.desc
              }}
              onChange={(importance) => { setDraft({ ...current, importance }) }}
            />
          </div>
          <textarea
            value={current.content}
            placeholder="记忆正文（用你原本的表述，写清「什么时候该这么做」）"
            onChange={(event) => { setDraft({ ...current, content: event.currentTarget.value }) }}
          />
        </div>
      </div>
    )
  }

/** 实体表单（新建 / 编辑共用，渲染在弹窗里）。模块级组件，便于单测直接渲染。 */
export function EntityDraftForm(props: {
  draft: EntityDraft
  disabled?: boolean
  onChange: (next: EntityDraft) => void
}): JSX.Element {
  const current = props.draft
  const setDraft = props.onChange
  return (
    <div className="mem-modal-body" data-dsh-memory-ui="">
      <div className="mem-draft-form">
        <Input
          value={current.name}
          placeholder="名称（同名或同别名会自动并入已有实体）"
          onChange={(event) => { setDraft({ ...current, name: event.currentTarget.value }) }}
        />
        <Segmented
          label="类别"
          value={current.kind}
          options={ENTITY_KIND_OPTIONS}
          disabled={props.disabled === true}
          onChange={(kind) => { setDraft({ ...current, kind }) }}
        />
        <Input
          value={current.aliases}
          placeholder="别名（可选，用 / 、 或逗号分隔）"
          onChange={(event) => { setDraft({ ...current, aliases: event.currentTarget.value }) }}
        />
        <Input
          value={current.summary}
          placeholder="一行说明（可选）"
          onChange={(event) => { setDraft({ ...current, summary: event.currentTarget.value }) }}
        />
      </div>
    </div>
  )
}

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

/** 记忆分区。 */
export function MemorySection(props: MemorySectionProps): JSX.Element {
  const memory = props.memory
  const [config, setConfig] = useState<MemoryConfig | null>(null)
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [projects, setProjects] = useState<readonly MemoryProjectSummary[]>([])
  const [records, setRecords] = useState<readonly MemoryRecord[]>([])
  const [tab, setTab] = useState<MemoryTab>('global')
  const [projectPath, setProjectPath] = useState('')
  const [keyword, setKeyword] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [resetOpen, setResetOpen] = useState(false)
  /** 详情抽屉：当前查看的那条（快照，操作后即关闭，避免看到过期内容）。 */
  const [detail, setDetail] = useState<MemoryRecord | null>(null)
  /** 沉淀面板：原文留档 + 后台调用审计。 */
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [raws, setRaws] = useState<readonly MemoryRawDocument[]>([])
  const [audits, setAudits] = useState<readonly MemoryAuditEntry[]>([])
  /** 展开过的原文全文（按留档 id 缓存，列表本身不带全文）。 */
  const [rawText, setRawText] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<readonly MemoryConflict[]>([])
  /** wiki 图层：实体目录 + 全量边（关联数、被提及数都在内存里聚合）。 */
  const [entities, setEntities] = useState<readonly MemoryEntity[]>([])
  const [edges, setEdges] = useState<readonly MemoryEdge[]>([])
  /** 实体表单草稿（id 为 null 表示新建）。 */
  const [entityDraft, setEntityDraft] = useState<EntityDraft | null>(null)
  /** 展开查看「关联记忆」的实体 id 与它那一次 listEdges 的结果。 */
  const [openEntityId, setOpenEntityId] = useState<string | null>(null)
  const [entityEdges, setEntityEdges] = useState<readonly MemoryEdge[]>([])
  /** 详情弹窗的关联视图与「连一条边」表单。 */
  const [neighborhood, setNeighborhood] = useState<MemoryNeighborhood | null>(null)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshOverview = useCallback(async () => {
    const [c, s, p, k] = await Promise.all([
      memory.getConfig(),
      memory.stats(),
      memory.projects(),
      memory.getConflicts(),
    ])
    if (c.ok) setConfig(c.value)
    else setError(errText(c.error))
    if (s.ok) setStats(s.value)
    else setError(errText(s.error))
    if (p.ok) setProjects(p.value)
    else setError(errText(p.error))
    if (k.ok) setConflicts(k.value)
    else setError(errText(k.error))
  }, [memory])

  const refreshRecords = useCallback(async () => {
    // 实体页签不按作用域筛选：拉全量条目（含归档），供「实体 → 关联记忆」在内存里映射。
    const query: Record<string, unknown> = tab === 'entity' ? { includeArchived: true } : { scope: tab }
    if (tab === 'project' && projectPath !== '') query.projectPath = projectPath
    if (tab !== 'entity' && keyword.trim() !== '') query.keyword = keyword.trim()
    if (tab !== 'entity' && includeArchived) query.includeArchived = true
    const result = await memory.list(query)
    if (result.ok) setRecords(result.value)
    else setError(errText(result.error))
  }, [memory, tab, projectPath, keyword, includeArchived])

  /** wiki 图层的取数：实体目录 + 全量边（一次拉全，关联数在内存里聚合）。 */
  const refreshWiki = useCallback(async () => {
    const [entityResult, edgeResult] = await Promise.all([
      // 远程端点有形参 arity 校验：不传对象会在客户端直接抛「expected 1 argument(s), got 0」，
      // 传空对象才是「不过滤、拉全量」。
      memory.listEntities({}),
      memory.listEdges({}),
    ])
    if (entityResult.ok) setEntities(entityResult.value)
    else setError(errText(entityResult.error))
    if (edgeResult.ok) setEdges(edgeResult.value)
    else setError(errText(edgeResult.error))
  }, [memory])

  useEffect(() => { void refreshOverview() }, [refreshOverview])
  useEffect(() => { void refreshRecords() }, [refreshRecords])
  useEffect(() => { void refreshWiki() }, [refreshWiki])

  /** 统一包一层 busy/error 处理并刷新。 */
  async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await action()
      await refreshOverview()
      await refreshRecords()
      await refreshWiki()
      if (done !== undefined) setNotice(done)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  /** 打开弹窗时清掉上一轮的提示，避免旧消息串进弹窗。 */
  function openModal(open: (value: boolean) => void): void {
    setError('')
    setNotice('')
    open(true)
  }

  function startEdit(record: MemoryRecord): void {
    setDraft({
      id: record.id,
      title: record.title,
      summary: record.summary,
      aliases: record.aliases.join(' / '),
      content: record.content,
      kind: record.kind,
      importance: record.importance,
      scope: record.scope,
      projectPath: record.projectPath,
    })
  }

  function startCreate(): void {
    setDraft({
      id: null,
      title: '',
      summary: '',
      aliases: '',
      content: '',
      kind: 'fact',
      importance: 3,
      scope: tab === 'project' ? 'project' : 'global',
      projectPath: tab === 'project' ? projectPath : '',
    })
  }

  /** 切页签：顺手清掉编辑态，免得弹窗开着、内容已经换了页。 */
  function switchTab(next: MemoryTab): void {
    setTab(next)
    setDraft(null)
    setEntityDraft(null)
    setOpenEntityId(null)
    setEntityEdges([])
  }

  async function saveDraft(): Promise<void> {
    if (draft === null) return
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (title === '' || content === '') {
      setError('标题与内容都不能为空')
      return
    }
    if (draft.scope === 'project' && draft.projectPath.trim() === '') {
      setError('项目记忆需要选择或填写一个工作区目录')
      return
    }
    await run(async () => {
      if (draft.id === null) {
        const result = await memory.save({
          title,
          content,
          summary: draft.summary.trim(),
          aliases: parseAliases(draft.aliases),
          kind: draft.kind,
          scope: draft.scope,
          ...(draft.scope === 'project' ? { projectPath: draft.projectPath.trim() } : {}),
          importance: draft.importance,
          source: 'user',
        })
        if (!result.ok) throw new Error(errText(result.error))
      } else {
        const result = await memory.updateMemory(draft.id as MemoryId, {
          title,
          content,
          summary: draft.summary.trim(),
          aliases: parseAliases(draft.aliases),
          kind: draft.kind,
          importance: draft.importance,
          scope: draft.scope,
          ...(draft.scope === 'project' ? { projectPath: draft.projectPath.trim() } : {}),
        })
        if (!result.ok) throw new Error(errText(result.error))
      }
      setDraft(null)
    }, '已保存。')
  }

  async function toggleFlag(record: MemoryRecord, patch: { pinned?: boolean; archived?: boolean }): Promise<void> {
    await run(async () => {
      const result = await memory.updateMemory(record.id, patch)
      if (!result.ok) throw new Error(errText(result.error))
    })
  }

  async function removeRecord(record: MemoryRecord): Promise<void> {
    await run(async () => {
      const result = await memory.removeMemory(record.id)
      if (!result.ok) throw new Error(errText(result.error))
      if (!result.value) throw new Error('未找到该记忆')
      if (draft?.id === record.id) setDraft(null)
    }, '已删除。')
  }

  async function copyExport(): Promise<void> {
    if (tab === 'entity') return
    await run(async () => {
      const result = await memory.exportText(tab, tab === 'project' ? projectPath : undefined)
      if (!result.ok) throw new Error(errText(result.error))
      try {
        await navigator.clipboard.writeText(result.value)
      } catch {
        throw new Error('复制失败：浏览器拒绝了剪贴板访问，可手动选中条目内容复制')
      }
    }, '已复制当前记忆的 Markdown，可粘贴到别的 AI 工具。')
  }

  async function runTidy(): Promise<void> {
    await run(async () => {
      const result = await memory.tidy()
      if (!result.ok) throw new Error(errText(result.error))
      setNotice('整理完成：合并 ' + result.value.merged + ' 组，回收 ' + result.value.removed + ' 条。')
    })
  }

  /** 重建自动边：共享实体的记忆两两相连，并清掉不再成立的自动边。 */
  async function runRebuildEdges(): Promise<void> {
    await run(async () => {
      const result = await memory.rebuildEdges()
      if (!result.ok) throw new Error(errText(result.error))
      setNotice('已重建关联：新增 ' + result.value.added + ' / 清理 ' + result.value.removed + '。')
    })
  }

  /* ---------- wiki 图层：实体 ---------- */

  function startCreateEntity(): void {
    setError('')
    setNotice('')
    setEntityDraft({ id: null, name: '', kind: 'project', aliases: '', summary: '' })
  }

  function startEditEntity(entity: MemoryEntity): void {
    setEntityDraft({
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      aliases: entity.aliases.join(' / '),
      summary: entity.summary,
    })
  }

  async function saveEntityDraft(): Promise<void> {
    if (entityDraft === null) return
    const name = entityDraft.name.trim()
    if (name === '') {
      setError('实体名称不能为空')
      return
    }
    await run(async () => {
      const result = await memory.upsertEntity({
        ...(entityDraft.id !== null ? { id: entityDraft.id } : {}),
        name,
        kind: entityDraft.kind,
        aliases: parseAliases(entityDraft.aliases),
        summary: entityDraft.summary.trim(),
      })
      if (!result.ok) throw new Error(errText(result.error))
      setEntityDraft(null)
    }, '已保存实体。')
  }

  async function removeEntity(entity: MemoryEntity): Promise<void> {
    await run(async () => {
      const result = await memory.removeEntity(entity.id)
      if (!result.ok) throw new Error(errText(result.error))
      if (!result.value) throw new Error('未找到该实体')
      if (openEntityId === entity.id) {
        setOpenEntityId(null)
        setEntityEdges([])
      }
    }, '已删除实体。')
  }

  /** 展开 / 收起实体的关联记忆：展开时按需拉这个实体相连的边。 */
  async function toggleEntityMemories(id: string): Promise<void> {
    if (openEntityId === id) {
      setOpenEntityId(null)
      setEntityEdges([])
      return
    }
    setOpenEntityId(id)
    setEntityEdges([])
    await run(async () => {
      const result = await memory.listEdges({ node: { kind: 'entity', id } })
      if (!result.ok) throw new Error(errText(result.error))
      setEntityEdges(result.value)
    })
  }

  /* ---------- wiki 图层：详情里的关联 ---------- */

  /** 取一条记忆的关联视图（详情弹窗的「关联」区块）。 */
  async function loadNeighborhood(id: string): Promise<void> {
    const result = await memory.neighborhood(id)
    if (result.ok) setNeighborhood(result.value ?? null)
    else setError(errText(result.error))
  }

  /** 打开详情：先用列表里的快照立即渲染，再补取关联数据。 */
  async function openDetail(record: MemoryRecord): Promise<void> {
    setError('')
    setNotice('')
    setDetail(record)
    setNeighborhood(null)
    setLinkDraft(null)
    await run(async () => { await loadNeighborhood(record.id) })
  }

  /** 关掉详情：连关联数据一起清掉，免得下次打开先闪一眼上一条的边。 */
  function closeDetail(): void {
    setDetail(null)
    setNeighborhood(null)
    setLinkDraft(null)
  }

  /** 从关联里的记忆节点跳到它的详情（可能不在当前列表，故整条取回）。 */
  async function jumpToMemory(id: string): Promise<void> {
    setError('')
    setNotice('')
    setLinkDraft(null)
    await run(async () => {
      const result = await memory.neighborhood(id)
      if (!result.ok) throw new Error(errText(result.error))
      if (result.value === undefined) throw new Error('未找到该记忆')
      setDetail(result.value.memory)
      setNeighborhood(result.value)
    })
  }

  /** 断开一条关联。 */
  async function removeEdge(edge: MemoryEdge): Promise<void> {
    if (detail === null) return
    const memoryId = detail.id
    await run(async () => {
      const result = await memory.unlink(edge.id)
      if (!result.ok) throw new Error(errText(result.error))
      if (!result.value) throw new Error('未找到该关联')
      await loadNeighborhood(memoryId)
      setNotice('已断开关联。')
    })
  }

  /** 从详情弹窗连一条边：from 固定是当前这条记忆，to 由表单指定。 */
  async function submitLink(): Promise<void> {
    if (detail === null || linkDraft === null) return
    const toId = linkDraft.toId.trim()
    if (toId === '') {
      setError(linkDraft.toKind === 'memory' ? '请先选择或填写目标记忆' : '请先选择或填写目标实体')
      return
    }
    const memoryId = detail.id
    const note = linkDraft.note.trim()
    await run(async () => {
      const result = await memory.link({
        from: { kind: 'memory', id: memoryId },
        to: { kind: linkDraft.toKind, id: toId },
        relation: linkDraft.relation,
        ...(note !== '' ? { note } : {}),
      })
      if (!result.ok) throw new Error(errText(result.error))
      await loadNeighborhood(memoryId)
      setLinkDraft(null)
      setNotice('已建立关联。')
    })
  }

  async function runImport(): Promise<void> {
    if (tab === 'entity') return
    if (importText.trim() === '') {
      setError('请先粘贴要导入的内容')
      return
    }
    if (tab === 'project' && projectPath === '') {
      setError('导入到项目记忆前，请先在下方选择目标项目')
      return
    }
    await run(async () => {
      const result = await memory.importText({
        text: importText,
        scope: tab,
        ...(tab === 'project' ? { projectPath } : {}),
        mode: importMode,
      })
      if (!result.ok) throw new Error(errText(result.error))
      setImportOpen(false)
      setImportText('')
      setNotice(
        '导入完成：新增 ' + result.value.added + ' 条，合并 ' + result.value.merged
        + ' 条，跳过 ' + result.value.skipped + ' 条'
        + (result.value.removed > 0 ? '，清空 ' + result.value.removed + ' 条' : '') + '。',
      )
    })
  }

  /** 拉沉淀面板的两段数据：原文留档（不带全文）+ 后台调用审计。 */
  async function loadLedger(): Promise<void> {
    const [rawResult, auditResult] = await Promise.all([
      memory.rawDocuments({ includeText: false, limit: 100 }),
      memory.audits({ limit: 50 }),
    ])
    if (rawResult.ok) setRaws(rawResult.value)
    else setError(errText(rawResult.error))
    if (auditResult.ok) setAudits(auditResult.value)
    else setError(errText(auditResult.error))
  }

  function openLedger(): void {
    openModal(setLedgerOpen)
    setRawText({})
    void run(loadLedger)
  }

  /** 展开某份原文的全文（第一次点才取，避免列表传输整库转录）。 */
  async function showRawText(id: MemoryRawId): Promise<void> {
    await run(async () => {
      const result = await memory.getRawDocument(id)
      if (!result.ok) throw new Error(errText(result.error))
      if (result.value === undefined) throw new Error('未找到该原文留档')
      setRawText((current) => ({ ...current, [id]: result.value?.text ?? '' }))
    })
  }

  async function reingestRaw(id: MemoryRawId): Promise<void> {
    await run(async () => {
      const result = await memory.reingest(id)
      if (!result.ok) throw new Error(errText(result.error))
      await loadLedger()
      setNotice('已重新抽取：新增 ' + result.value.added + ' 条，合并 ' + result.value.merged + ' 条。')
    })
  }

  async function removeRaw(id: MemoryRawId, title: string): Promise<void> {
    await run(async () => {
      const result = await memory.removeRawDocument(id)
      if (!result.ok) throw new Error(errText(result.error))
      if (!result.value) throw new Error('未找到该原文留档')
      await loadLedger()
      setNotice('已删除原文留档「' + title + '」（已抽出的记忆条目保持不动）。')
    })
  }

  async function copyRecord(record: MemoryRecord): Promise<void> {
    await run(async () => {
      try {
        await navigator.clipboard.writeText(record.title + '\n\n' + record.content)
      } catch {
        throw new Error('复制失败：浏览器拒绝了剪贴板访问，可手动选中正文复制')
      }
    }, '已复制全文。')
  }

  async function runReset(): Promise<void> {
    if (tab === 'entity') return
    if (tab === 'project' && projectPath === '') {
      setError('请先选择要重置的项目')
      return
    }
    await run(async () => {
      const result = await memory.reset(tab, tab === 'project' ? projectPath : undefined)
      if (!result.ok) throw new Error(errText(result.error))
      setResetOpen(false)
      setNotice('已重置 ' + SCOPE_LABELS[tab] + '：清空 ' + result.value + ' 条。')
    })
  }

  const counts: Record<MemoryTab, number> = {
    global: stats?.global ?? 0,
    project: stats?.project ?? 0,
    entity: stats?.entities ?? 0,
  }
  const activeProjectLabel = projects.find((item) => item.path === projectPath)?.label ?? projectPath

  /** 内存聚合：每条记忆的关联数 / 每个实体的被提及数（只依赖那一次 listEdges 的结果）。 */
  const linkCounts = memoryLinkCounts(edges)
  const mentionCounts = entityMentionCounts(edges)

  /** 单条记忆（正常态）。 */
  function renderRecord(record: MemoryRecord): JSX.Element {
    return (
      <div className="mem-item" key={record.id}>
        <div className="mem-item-head">
          <Pill>{MEMORY_KIND_LABELS[record.kind]}</Pill>
          <span className="mem-item-title" title={record.title}>{record.title}</span>
          <Pill>{importanceLabel(record.importance)}</Pill>
          <Pill>{'关联 ' + (linkCounts.get(record.id) ?? 0)}</Pill>
          <div className="mem-item-actions">
            <Button
              variant="ghost" size="sm" title="查看元数据、关联与全文"
              onClick={() => { void openDetail(record) }}
            >
              详情
            </Button>
            <Button
              variant="ghost" size="sm" title={record.pinned ? '取消置顶' : '置顶'}
              onClick={() => { void toggleFlag(record, { pinned: !record.pinned }) }}
            >
              {record.pinned ? '已置顶' : '置顶'}
            </Button>
            <Button
              variant="ghost" size="sm" icon={<IconArchiveOutline20 size={14} />}
              title={record.archived ? '恢复' : '归档'}
              onClick={() => { void toggleFlag(record, { archived: !record.archived }) }}
            />
            <Button
              variant="ghost" size="sm" icon={<IconEditOutline16 size={14} />} title="编辑"
              onClick={() => { startEdit(record) }}
            />
            <Button
              variant="ghost" size="sm" icon={<IconTrashOutline16 size={14} />} title="删除"
              onClick={() => { void removeRecord(record) }}
            />
          </div>
        </div>
        {record.summary !== '' && <p className="mem-item-summary">{record.summary}</p>}
        {record.aliases.length > 0 && (
          <span className="mem-item-alias">{'别名：' + record.aliases.join(' / ')}</span>
        )}
        <p className="mem-item-body">{record.content}</p>
        {record.archived && <span className="mem-notice">已归档（不参与注入，可随时恢复）</span>}
      </div>
    )
  }

  /** 实体页签：目录 + 每个实体关联的记忆（点开才取那一次的边）。 */
  function renderEntities(): JSX.Element {
    const linkedIds = openEntityId === null ? [] : linkedMemoryIds(entityEdges, openEntityId)
    const linkedRecords = linkedIds
      .map((id) => records.find((record) => record.id === id))
      .filter((record): record is MemoryRecord => record !== undefined)
    return (
      <>
        <div className="mem-head">
          <span className="mem-head-title">实体目录</span>
          <div className="mem-toolbar">
            <Button
              variant="ghost" size="sm" icon={<IconPlusOutline16 size={14} />}
              disabled={locked} onClick={startCreateEntity}
            >
              新建实体
            </Button>
          </div>
        </div>
        <p className="mem-row-desc">
          实体是 wiki 图层里的「名词」（项目 / 工具 / 人…）：记忆通过「关于 / 提及」挂到它上面，
          共享同一个实体的记忆会自动连成「相关」。写记忆时声明实体，或在这里手工维护。
        </p>
        <div className="mem-list">
          {entities.map((entity) => (
            <div className="mem-item" key={entity.id}>
              <div className="mem-item-head">
                <span className={'mem-entity-badge ' + entityKindClass(entity.kind)}>
                  {MEMORY_ENTITY_KIND_LABELS[entity.kind]}
                </span>
                <button
                  type="button"
                  className="mem-item-title mem-entity-name"
                  title="查看关联的记忆"
                  onClick={() => { void toggleEntityMemories(entity.id) }}
                >
                  {entity.name}
                </button>
                <span className="mem-raw-meta">{'被提及 ' + (mentionCounts.get(entity.id) ?? 0) + ' 条'}</span>
                <div className="mem-item-actions">
                  <Button
                    variant="ghost" size="sm" icon={<IconEditOutline16 size={14} />} title="编辑"
                    onClick={() => { startEditEntity(entity) }}
                  />
                  <Button
                    variant="ghost" size="sm" icon={<IconTrashOutline16 size={14} />} title="删除"
                    onClick={() => { void removeEntity(entity) }}
                  />
                </div>
              </div>
              {entity.aliases.length > 0 && (
                <span className="mem-item-alias">{'别名：' + entity.aliases.join(' / ')}</span>
              )}
              {entity.summary !== '' && <p className="mem-item-summary">{entity.summary}</p>}
              {openEntityId === entity.id && (
                <div className="mem-entity-links">
                  {linkedRecords.length === 0 ? (
                    <span className="mem-row-desc">还没有记忆关联到这个实体。</span>
                  ) : linkedRecords.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      className="mem-entity-link"
                      title="查看这条记忆"
                      onClick={() => { void openDetail(record) }}
                    >
                      {record.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {entities.length === 0 && (
            <div className="mem-empty">
              还没有实体。写记忆时声明「这条讲的是谁」，或点上面的「新建实体」手工加一个。
            </div>
          )}
        </div>
      </>
    )
  }


  // 冲突 = 硬锁：本插件整体让位，界面把所有操作入口关掉，只留红色警告。
  const locked = conflicts.length > 0

  // 「生成对话记忆」关闭时宿主侧的自动提炼直接早退（src/agent/capture.ts），
  // 高级 · 自动提炼 里的参数一律不生效 —— 界面同步置灰，免得调了没反应。
  const captureOff = !locked && config !== null && !(config.autoCapture ?? false)

  return (
    <div className="mem-section" data-dsh-memory-ui="">
      <div className="mem-title-row">
        <h2 className="mem-title">记忆</h2>
        <span className="mem-version" title="插件版本">v{pluginVersion()}</span>
      </div>
      <p className="mem-intro">
        记住你的偏好和习惯，对话越多，它就越懂你。记忆内容本地保存，仅你本人可见。
      </p>

      {locked && (
        <div className="mem-warn" role="alert">
          <strong>检测到另一个记忆插件 —— 本插件已锁定，无法开启</strong>
          <p>
            已有插件占用了 {conflicts.map((conflict) => conflict.name).join('、')}。
            本插件已整体让位：不注册任何 memory 工具、不注入记忆、不自动生成对话记忆，
            下面所有开关也都不可操作。
          </p>
          <p>
            请在「设置 → 插件」里停用另一个记忆插件，然后重启 dsh，本插件会自动解锁。
          </p>
          {conflicts[0] !== undefined && conflicts[0].description !== '' && (
            <p className="mem-warn-src">对方工具描述：{conflicts[0].description}</p>
          )}
        </div>
      )}

      <div className="mem-card">
        <SwitchRow
          title="生成对话记忆"
          desc="允许从对话中提取并记住相关上下文，以便在未来对话中提供更连贯、个性化的回应。"
          checked={locked ? false : (config?.autoCapture ?? false)}
          disabled={busy || config === null || locked}
          onChange={(next) => { void run(async () => { await memory.setConfig({ autoCapture: next }) }) }}
        />
        <SwitchRow
          title="开场自动注入"
          desc="新会话开局把「全局 + 当前工作区」的高重要性记忆注入上下文，不必等你再提醒。"
          checked={locked ? false : (config?.autoInject ?? false)}
          disabled={busy || config === null || locked}
          onChange={(next) => { void run(async () => { await memory.setConfig({ autoInject: next }) }) }}
        />
        <SwitchRow
          title="写入判定"
          desc="写入前如果附近已经有很像的记忆，先让模型判一次「新建 / 并进哪一条 / 不用记」（一次一行 JSON，失败就退化成新建）。关掉只走字面阈值。"
          checked={locked ? false : (config?.autoJudge ?? false)}
          disabled={busy || config === null || locked}
          onChange={(next) => { void run(async () => { await memory.setConfig({ autoJudge: next }) }) }}
        />
        <div className="mem-field-row">
          <span>单次注入条数</span>
          <Input
            type="number" min={1} max={20}
            disabled={locked}
            value={String(config?.maxInjected ?? 6)}
            onChange={(event) => {
              const value = Number(event.currentTarget.value)
              if (!Number.isFinite(value)) return
              void run(async () => { await memory.setConfig({ maxInjected: Math.min(20, Math.max(1, Math.round(value))) }) })
            }}
          />
          <span>（达到门槛或被置顶的记忆才会注入）</span>
        </div>
        <div className="mem-seg-row">
          <span className="mem-seg-label">注入门槛</span>
          <ScaleSlider
            label="注入门槛"
            value={config?.importanceThreshold ?? MEMORY_CONFIG_BASE.importanceThreshold}
            steps={IMPORTANCE_STEPS}
            disabled={busy || config === null || locked}
            describe={(value) => {
              const level = importanceLevelAt(value)
              return <><b>{level.label}</b>{' · '}{level.desc}</>
            }}
            valueText={(value) => {
              const level = importanceLevelAt(value)
              return level.label + '（' + value + '/5）'
            }}
            onChange={(importanceThreshold) => {
              void run(async () => { await memory.setConfig({ importanceThreshold }) })
            }}
          />
        </div>
        <details className="mem-advanced">
          <summary>
            <span>高级 · 自动提炼</span>
            <ChevronDown className="mem-advanced-chevron" size={14} aria-hidden="true" />
          </summary>
          {captureOff && (
            <p className="mem-advanced-hint">「生成对话记忆」已关闭，以下参数暂不生效。</p>
          )}
          <div className={captureOff ? 'mem-advanced-body mem-advanced-off' : 'mem-advanced-body'}>
            <ScaleSlider
              label="提炼间隔"
              value={config?.captureEveryTurns ?? MEMORY_CONFIG_BASE.captureEveryTurns}
              steps={CAPTURE_EVERY_STEPS}
              disabled={busy || config === null || locked || captureOff}
              describe={(value) => (value === 1 ? '每个回合都提炼一次' : '每 ' + value + ' 个回合提炼一次')}
              valueText={(value) => value + ' 个回合一次'}
              onChange={(captureEveryTurns) => { void run(async () => { await memory.setConfig({ captureEveryTurns }) }) }}
            />
            <ScaleSlider
              label="转录轮数"
              value={config?.captureMaxTurns ?? MEMORY_CONFIG_BASE.captureMaxTurns}
              steps={CAPTURE_TURNS_STEPS}
              disabled={busy || config === null || locked || captureOff}
              describe={(value) => '只把最近 ' + value + ' 轮对话送去提炼'}
              valueText={(value) => value + ' 轮'}
              onChange={(captureMaxTurns) => { void run(async () => { await memory.setConfig({ captureMaxTurns }) }) }}
            />
            <ScaleSlider
              label="转录字符上限"
              value={config?.captureMaxChars ?? MEMORY_CONFIG_BASE.captureMaxChars}
              steps={CAPTURE_CHARS_STEPS}
              disabled={busy || config === null || locked || captureOff}
              describe={(value) => value + ' 字，超出保留尾部'}
              valueText={(value) => value + ' 字'}
              onChange={(captureMaxChars) => { void run(async () => { await memory.setConfig({ captureMaxChars }) }) }}
            />
            <SwitchRow
              title="助手回复也作为提炼素材"
              desc="默认关闭：结论类记忆由 agent 主动写入，避免每轮顺手把排查过程也记下来。"
              checked={config?.captureIncludeAssistant ?? false}
              disabled={busy || config === null || locked || captureOff}
              onChange={(next) => { void run(async () => { await memory.setConfig({ captureIncludeAssistant: next }) }) }}
            />
          </div>
        </details>
      </div>

      <div className="mem-head">
        <span className="mem-head-title">管理记忆</span>
        <div className="mem-toolbar">
          <Button variant="ghost" size="sm" icon={<IconPlusOutline16 size={14} />} disabled={locked || tab === 'entity'} onClick={startCreate}>新增</Button>
          <Button variant="ghost" size="sm" icon={<IconChecklistOutline14 size={14} />} disabled={busy || locked || tab === 'entity'} onClick={() => { void runTidy() }}>整理</Button>
          <Button variant="ghost" size="sm" icon={<IconRefreshOutline16 size={14} />} disabled={busy || locked} onClick={() => { void runRebuildEdges() }}>重建关联</Button>
          <Button variant="ghost" size="sm" icon={<IconCopyOutline16 size={14} />} disabled={busy || locked || tab === 'entity'} onClick={() => { void copyExport() }}>复制</Button>
          <Button variant="ghost" size="sm" icon={<IconRefreshOutline16 size={14} />} disabled={locked || tab === 'entity'} onClick={() => { openModal(setResetOpen) }}>重置</Button>
          <Button variant="ghost" size="sm" icon={<IconDownloadOutline16 size={14} />} disabled={locked || tab === 'entity'} onClick={() => { openModal(setImportOpen) }}>导入</Button>
          <Button variant="ghost" size="sm" icon={<IconListPenOutline16 size={14} />} disabled={locked} onClick={openLedger}>沉淀</Button>
        </div>
      </div>

      <div className="mem-tabs" aria-label="记忆视图">
        {MEMORY_TABS.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={tab === item ? 'true' : undefined}
            className={tab === item ? 'mem-tab mem-tab-active' : 'mem-tab'}
            onClick={() => { switchTab(item) }}
          >
            {TAB_LABELS[item]}
            <span className="mem-tab-count">{counts[item]}</span>
          </button>
        ))}
      </div>

      <datalist id="mem-project-options">
        {projects.map((item) => <option key={item.path} value={item.path} />)}
      </datalist>

      {error !== '' && <span className="mem-error">{error}</span>}
      {notice !== '' && <span className="mem-notice">{notice}</span>}

      {tab === 'entity' ? renderEntities() : (
        <>
          <div className="mem-field-row">
            {tab === 'project' && (
              <>
                <span>项目</span>
                <select
                  className="mem-select"
                  value={projectPath}
                  onChange={(event) => { setProjectPath(event.currentTarget.value); setDraft(null) }}
                >
                  <option value="">选择工作区…</option>
                  {projects.map((item) => (
                    <option key={item.path} value={item.path}>{item.label + '（' + item.count + ' 条）'}</option>
                  ))}
                </select>
              </>
            )}
            <Input
              className="mem-search"
              value={keyword}
              placeholder="搜索标题 / 正文 / 摘要 / 别名 / 标签"
              onChange={(event) => { setKeyword(event.currentTarget.value) }}
            />
            <label className="mem-field-row">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => { setIncludeArchived(event.currentTarget.checked) }}
              />
              <span>含已归档</span>
            </label>
            <span>共 {records.length} 条</span>
            {stats !== null && (
              <span>原文 {stats.raw} · 调用 {stats.audits}</span>
            )}
          </div>

          <div className="mem-list">
            {records.map((record) => renderRecord(record))}
            {records.length === 0 && (
              <div className="mem-empty">
                {tab === 'global'
                  ? '还没有全局记忆。和 AI 多聊几句，它会自动记住你的偏好；也可以点「新增」或「导入」手工添加。'
                  : '还没有这个项目的记忆。在对应工作区里对话后，与项目相关的习惯会自动记到这里。'}
              </div>
            )}
          </div>
        </>
      )}

      <Modal
        className="mem-modal-wide"
        open={importOpen}
        onClose={() => { setImportOpen(false) }}
        title="导入其他记忆"
        closeLabel="关闭"
        description={tab === 'project' ? '将导入到「项目记忆 · ' + (activeProjectLabel === '' ? '未选择项目' : activeProjectLabel) + '」' : '将导入到「全局记忆」'}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setImportOpen(false) }}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void runImport() }}>添加到记忆</Button>
          </>
        )}
      >
        <div className="mem-modal-body" data-dsh-memory-ui="">
          <span className="mem-row-title">1. 复制以下提示词到其他 AI 对话中</span>
          <div className="mem-prompt">{IMPORT_PROMPT_TEXT}</div>
          <div className="mem-item-actions">
            <Button
              variant="outline" size="sm" icon={<IconCopyOutline16 size={14} />}
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(IMPORT_PROMPT_TEXT)
                    setNotice('提示词已复制。')
                  } catch {
                    setError('复制失败，请手动选中提示词复制。')
                  }
                })()
              }}
            >
              复制提示词
            </Button>
          </div>
          <span className="mem-row-title">2. 将结果粘贴到下方，添加到记忆</span>
          <textarea
            className="mem-import-area"
            value={importText}
            placeholder="粘贴整理好的画像（分类标题 + [日期] - 内容 的格式会被自动识别）"
            onChange={(event) => { setImportText(event.currentTarget.value) }}
          />
          <Segmented
            label="导入方式"
            value={importMode}
            options={IMPORT_MODE_OPTIONS}
            disabled={busy}
            onChange={setImportMode}
          />
          <ModalFeedback error={error} notice={notice} />
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => { setResetOpen(false) }}
        title="重置记忆"
        closeLabel="关闭"
        description={'将清空「' + (tab === 'project' ? SCOPE_LABELS.project : SCOPE_LABELS.global) + (tab === 'project' && activeProjectLabel !== '' ? ' · ' + activeProjectLabel : '') + '」的全部记忆'}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setResetOpen(false) }}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void runReset() }}>确认重置</Button>
          </>
        )}
      >
        <div className="mem-modal-body" data-dsh-memory-ui="">
          <p className="mem-row-desc">
            这一步不可撤销。如果只是想暂时不让它参与注入，建议改用「归档」——
            归档的记忆仍保留在库里，随时可以恢复。
          </p>
          <span className="mem-notice">当前作用域共 {records.length} 条（含筛选条件）。</span>
          <ModalFeedback error={error} notice={notice} />
        </div>
      </Modal>

      <Modal
        className="mem-modal-wide"
        open={detail !== null}
        onClose={closeDetail}
        title={detail?.title ?? '记忆详情'}
        closeLabel="关闭"
        description={detail === null || detail.scope === 'global'
          ? '全局记忆'
          : '项目记忆 · ' + detail.projectPath}
        footer={(
          <>
            <Button variant="ghost" onClick={closeDetail}>关闭</Button>
            <Button variant="ghost" disabled={busy || locked} onClick={() => { if (detail !== null) void copyRecord(detail) }}>复制全文</Button>
            <Button
              variant="ghost" disabled={busy || locked}
              onClick={() => {
                if (detail === null) return
                const target = detail
                setDetail(null)
                void toggleFlag(target, { archived: !target.archived })
              }}
            >
              {detail?.archived === true ? '恢复' : '归档'}
            </Button>
            <Button
              variant="ghost" disabled={locked}
              onClick={() => { if (detail === null) return; const target = detail; setDetail(null); startEdit(target) }}
            >
              编辑
            </Button>
            <Button
              variant="primary" disabled={busy || locked}
              onClick={() => { if (detail === null) return; const target = detail; setDetail(null); void removeRecord(target) }}
            >
              删除
            </Button>
          </>
        )}
      >
        <div className="mem-modal-body" data-dsh-memory-ui="">
          {detail !== null && (
            <>
              <div className="mem-meta">
                <span className="mem-meta-key">分类</span>
                <span className="mem-meta-value">{MEMORY_KIND_LABELS[detail.kind]}</span>
                {detail.summary !== '' && (
                  <>
                    <span className="mem-meta-key">摘要</span>
                    <span className="mem-meta-value">{detail.summary}</span>
                  </>
                )}
                {detail.aliases.length > 0 && (
                  <>
                    <span className="mem-meta-key">别名</span>
                    <span className="mem-meta-value">{detail.aliases.join(' / ')}</span>
                  </>
                )}
                <span className="mem-meta-key">重要性</span>
                <span className="mem-meta-value">{importanceLabel(detail.importance) + '（' + detail.importance + '/5）'}</span>
                <span className="mem-meta-key">来源</span>
                <span className="mem-meta-value">{sourceLabel(detail.source)}</span>
                <span className="mem-meta-key">创建</span>
                <span className="mem-meta-value">{timeText(detail.createdAt)}</span>
                <span className="mem-meta-key">更新</span>
                <span className="mem-meta-value">{timeText(detail.updatedAt)}</span>
                <span className="mem-meta-key">置顶 / 归档</span>
                <span className="mem-meta-value">
                  {(detail.pinned ? '置顶' : '未置顶') + ' · ' + (detail.archived ? '已归档（不参与注入）' : '正常')}
                </span>
                {detail.tags.length > 0 && (
                  <>
                    <span className="mem-meta-key">标签</span>
                    <span className="mem-meta-value">{detail.tags.join('、')}</span>
                  </>
                )}
                {detail.sessionId !== undefined && detail.sessionId !== '' && (
                  <>
                    <span className="mem-meta-key">会话</span>
                    <span className="mem-meta-value">{detail.sessionId}</span>
                  </>
                )}
              </div>
              <pre className="mem-detail-body">{detail.content}</pre>

              <div className="mem-edge-block">
                <span className="mem-row-title">{'关联（' + (neighborhood?.edges.length ?? 0) + '）'}</span>
                {neighborhood === null && <p className="mem-row-desc">正在读取关联…</p>}
                {neighborhood !== null && neighborhood.edges.length === 0 && (
                  <p className="mem-row-desc">
                    还没有关联。写记忆时声明实体就会自动连上；也可以手动连一条边。
                  </p>
                )}
                {neighborhood !== null && neighborhood.edges.length > 0 && (
                  <EdgeList
                    edges={neighborhood.edges}
                    related={neighborhood.related}
                    disabled={busy || locked}
                    onJump={(id) => { void jumpToMemory(id) }}
                    onUnlink={(edge) => { void removeEdge(edge) }}
                  />
                )}

                {linkDraft === null ? (
                  <div className="mem-item-actions">
                    <Button
                      variant="outline" size="sm" icon={<IconPlusOutline16 size={14} />}
                      disabled={busy || locked}
                      onClick={() => { setLinkDraft({ toKind: 'memory', toId: '', relation: 'related', note: '' }) }}
                    >
                      连一条边
                    </Button>
                  </div>
                ) : (
                  <div className="mem-link-form">
                    <Segmented
                      label="目标类型"
                      value={linkDraft.toKind}
                      options={NODE_KIND_OPTIONS}
                      disabled={busy || locked}
                      onChange={(toKind) => { setLinkDraft({ ...linkDraft, toKind, toId: '' }) }}
                    />
                    <div className="mem-field-row">
                      <Input
                        list="mem-link-target-options"
                        value={linkDraft.toId}
                        placeholder={linkDraft.toKind === 'memory' ? '目标记忆 id（可从下拉里挑）' : '目标实体 id（可从下拉里挑）'}
                        onChange={(event) => { setLinkDraft({ ...linkDraft, toId: event.currentTarget.value }) }}
                      />
                    </div>
                    <datalist id="mem-link-target-options">
                      {(linkDraft.toKind === 'memory'
                        ? records.map((record) => ({ id: record.id as string, label: record.title }))
                        : entities.map((entity) => ({ id: entity.id as string, label: entity.name }))
                      ).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </datalist>
                    <div className="mem-field-row">
                      <span>关系</span>
                      <select
                        className="mem-select"
                        value={linkDraft.relation}
                        disabled={busy || locked}
                        onChange={(event) => {
                          setLinkDraft({ ...linkDraft, relation: event.currentTarget.value as MemoryEdgeRelation })
                        }}
                      >
                        {RELATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <Input
                      value={linkDraft.note}
                      placeholder="备注（可选，写清为什么连这条边）"
                      onChange={(event) => { setLinkDraft({ ...linkDraft, note: event.currentTarget.value }) }}
                    />
                    <div className="mem-item-actions">
                      <Button variant="primary" size="sm" disabled={busy || locked} onClick={() => { void submitLink() }}>连接</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setLinkDraft(null) }}>取消</Button>
                    </div>
                  </div>
                )}
              </div>

              <ModalFeedback error={error} notice={notice} />
            </>
          )}
        </div>
      </Modal>

      <Modal
        className="mem-modal-wide"
        open={ledgerOpen}
        onClose={() => { setLedgerOpen(false) }}
        title="沉淀与后台调用"
        closeLabel="关闭"
        description="原文留档是抽取的第一段：模型抽不出、调用失败，原文都还在，可以随时重抽。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setLedgerOpen(false) }}>关闭</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { void run(loadLedger) }}>刷新</Button>
          </>
        )}
      >
        <div className="mem-modal-body" data-dsh-memory-ui="">
          <span className="mem-row-title">原文留档（{raws.length}）</span>
          {raws.length === 0 && (
            <p className="mem-row-desc">还没有留档。导入一份画像、或在工作区里对话一轮，这里就会出现原文。</p>
          )}
          <div className="mem-raw-list">
            {raws.map((raw) => (
              <div className="mem-raw-item" key={raw.id}>
                <div className="mem-item-head">
                  <Pill>{ORIGIN_LABELS[raw.origin] ?? raw.origin}</Pill>
                  <span className="mem-item-title" title={raw.title}>{raw.title}</span>
                  <span className="mem-raw-meta">
                    {timeText(raw.createdAt) + ' · ' + raw.textLength + ' 字 · 抽出 ' + raw.recordIds.length + ' 条'}
                  </span>
                  <div className="mem-item-actions">
                    <Button
                      variant="ghost" size="sm" disabled={busy}
                      onClick={() => {
                        if (rawText[raw.id] !== undefined) {
                          setRawText((current) => {
                            const next = { ...current }
                            delete next[raw.id]
                            return next
                          })
                          return
                        }
                        void showRawText(raw.id)
                      }}
                    >
                      {rawText[raw.id] === undefined ? '看原文' : '收起'}
                    </Button>
                    <Button
                      variant="ghost" size="sm" disabled={busy || locked}
                      title="用当前解析器对这份原文重跑抽取"
                      onClick={() => { void reingestRaw(raw.id) }}
                    >
                      重抽
                    </Button>
                    <Button
                      variant="ghost" size="sm" icon={<IconTrashOutline16 size={14} />}
                      disabled={busy || locked} title="删除留档（不动已抽出的条目）"
                      onClick={() => { void removeRaw(raw.id, raw.title) }}
                    />
                  </div>
                </div>
                {rawText[raw.id] !== undefined && <pre className="mem-raw-text">{rawText[raw.id]}</pre>}
              </div>
            ))}
          </div>

          <span className="mem-row-title">后台模型调用（{audits.length}）</span>
          {audits.length === 0 && <p className="mem-row-desc">还没有后台调用记录。</p>}
          <div className="mem-audit-list">
            {audits.map((entry) => (
              <div className="mem-audit-item" key={entry.id}>
                <span className={entry.ok ? 'mem-audit-ok' : 'mem-audit-bad'}>{entry.ok ? '成功' : '失败'}</span>
                <span className="mem-raw-meta">{AUDIT_KIND_LABELS[entry.kind] ?? entry.kind}</span>
                <span className="mem-raw-meta">{timeText(entry.at)}</span>
                <span className="mem-audit-model">{entry.provider + ' / ' + entry.model}</span>
                <span className="mem-raw-meta">
                  {durationText(entry.durationMs) + ' · 入 ' + entry.inputChars + ' 字 / 出 ' + entry.outputChars
                    + ' 字 · ' + entry.recordIds.length + ' 条'}
                </span>
                {entry.tokensIn !== undefined && (
                  <span className="mem-raw-meta">{'token ' + entry.tokensIn + ' → ' + (entry.tokensOut ?? '?')}</span>
                )}
                {entry.error !== undefined && <span className="mem-audit-error">{entry.error}</span>}
              </div>
            ))}
          </div>
          <ModalFeedback error={error} notice={notice} />
        </div>
      </Modal>

      <Modal
        className="mem-modal-wide"
        open={draft !== null}
        onClose={() => { setDraft(null) }}
        title={draft?.id === null ? '新增记忆' : '编辑记忆'}
        closeLabel="关闭"
        description="用你原本的表述写清「什么时候该这么做」，以后新会话就照这个来。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setDraft(null) }}>取消</Button>
            <Button variant="primary" disabled={busy || locked} onClick={() => { void saveDraft() }}>保存</Button>
          </>
        )}
      >
        {draft !== null && (
          <MemoryDraftForm draft={draft} disabled={locked} onChange={(next) => { setDraft(next) }} />
        )}
      </Modal>

      <Modal
        className="mem-modal-wide"
        open={entityDraft !== null}
        onClose={() => { setEntityDraft(null) }}
        title={entityDraft?.id === null ? '新建实体' : '编辑实体'}
        closeLabel="关闭"
        description="实体是 wiki 图层里的名词：名称或别名命中已有实体会自动并入，不会长出重复条目。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setEntityDraft(null) }}>取消</Button>
            <Button variant="primary" disabled={busy || locked} onClick={() => { void saveEntityDraft() }}>保存</Button>
          </>
        )}
      >
        {entityDraft !== null && (
          <EntityDraftForm draft={entityDraft} disabled={locked} onChange={(next) => { setEntityDraft(next) }} />
        )}
      </Modal>
    </div>
  )
}
