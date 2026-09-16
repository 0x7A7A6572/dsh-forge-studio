/**
 * plugin-memory × agent harness 桥（host 侧）—— 记忆读写工具注册。
 *
 * 7 个工具：memory_save / memory_search / memory_list / memory_update /
 * memory_delete / memory_archive / memory_move。
 *
 * 作用域判定（产品决策：模型自动判定，UI 可手动移动）：
 * - 工具参数 scope 必填，迫使模型显式判断「这是普适偏好还是单项目习惯」；
 * - scope=project 且没给 project_path 时，用当前会话的 cwd 兜底（模型不必知道路径）。
 *
 * 工具以 tools 服务判存后条件挂载（ctx.inject），纯 UI 宿主照常工作（不注册工具）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  MemoryConflict, MemoryEdge, MemoryEdgeOrigin, MemoryEdgeRelation, MemoryEntity, MemoryEntityId,
  MemoryEntityKind, MemoryId, MemoryKind, MemoryNodeRef, MemoryRecord, MemoryScope,
} from '../types.ts'
import {
  MEMORY_EDGE_ORIGINS, MEMORY_EDGE_RELATION_LABELS, MEMORY_EDGE_RELATIONS, MEMORY_ENTITY_KINDS,
  MEMORY_ENTITY_KIND_LABELS, MEMORY_KIND_LABELS, MEMORY_KINDS, importanceLabel,
} from '../types.ts'
import type { MemoryService } from '../service.ts'
import { projectLabelOf } from '../service.ts'
import { detectToolConflicts, type ToolProbe } from '../conflicts.ts'

export const MEMORY_TOOL_PREFIX = 'memory_'

export const TOOL_SAVE = MEMORY_TOOL_PREFIX + 'save'
export const TOOL_SEARCH = MEMORY_TOOL_PREFIX + 'search'
export const TOOL_LIST = MEMORY_TOOL_PREFIX + 'list'
export const TOOL_UPDATE = MEMORY_TOOL_PREFIX + 'update'
export const TOOL_DELETE = MEMORY_TOOL_PREFIX + 'delete'
export const TOOL_ARCHIVE = MEMORY_TOOL_PREFIX + 'archive'
export const TOOL_MOVE = MEMORY_TOOL_PREFIX + 'move'
/** 实体与边的工具（wiki 图层）。 */
export const TOOL_ENTITY = MEMORY_TOOL_PREFIX + 'entity'
export const TOOL_LINK = MEMORY_TOOL_PREFIX + 'link'

export function isMemoryTool(name: string): boolean {
  return name.startsWith(MEMORY_TOOL_PREFIX)
}

/** 会话上下文（id + 工作区目录），任何一步不可用都安全降级为空。 */
export interface MemorySessionContext {
  readonly sessionId?: string
  readonly cwd?: string
}

export function sessionContextOf(exec: unknown): MemorySessionContext {
  try {
    const agent = (exec as { agent?: { session?: { id?: unknown; header?: { cwd?: unknown } } } } | undefined)?.agent
    const session = agent?.session
    if (session === undefined || session === null) return {}
    const id = typeof session.id === 'string' && session.id !== '' ? session.id : undefined
    const cwd = typeof session.header?.cwd === 'string' && session.header.cwd !== '' ? session.header.cwd : undefined
    return { ...(id !== undefined ? { sessionId: id } : {}), ...(cwd !== undefined ? { cwd } : {}) }
  } catch {
    return {}
  }
}

/** 工具返回的紧凑视图（形状与 RECORD_ITEM_SCHEMA 一致，供类型推断对齐）。 */
export interface MemoryToolRecord {
  id: string
  kind: MemoryKind
  scope: MemoryScope
  projectPath: string
  title: string
  content: string
  summary: string
  aliases: string[]
  importance: number
  tags: string[]
  pinned: boolean
  archived: boolean
  updatedAt: string
}

/** 记录 → 工具返回的紧凑视图。 */
export function describeRecord(record: MemoryRecord): MemoryToolRecord {
  return {
    id: record.id,
    kind: record.kind,
    scope: record.scope,
    projectPath: record.projectPath,
    title: record.title,
    content: record.content,
    summary: record.summary,
    aliases: record.aliases,
    importance: record.importance,
    tags: record.tags,
    pinned: record.pinned,
    archived: record.archived,
    updatedAt: new Date(record.updatedAt).toISOString(),
  }
}

/** 边的工具返回视图：端点用 'kind:id' 文本 + 可读标签，模型不必自己解析 id。 */
export interface MemoryToolEdge {
  id: string
  relation: MemoryEdgeRelation
  relationLabel: string
  from: string
  to: string
  fromLabel: string
  toLabel: string
  note: string
  origin: MemoryEdgeOrigin
  weight: number
}

/** 实体 → 工具返回的紧凑视图。 */
export interface MemoryToolEntity {
  id: string
  name: string
  kind: MemoryEntityKind
  kindLabel: string
  aliases: string[]
  summary: string
  archived: boolean
  updatedAt: string
}

/** 记录 → 工具返回的紧凑视图（附别名与摘要，便于模型判断是否同一条）。 */
function render(records: readonly MemoryToolRecord[], emptyHint: string): string {
  if (records.length === 0) return emptyHint
  return records.map((record) => {
    const where = record.scope === 'global' ? '全局' : '项目:' + projectLabelOf(record.projectPath)
    const flag = record.archived ? ' [已归档]' : ''
    const alias = record.aliases.length > 0 ? '（别名：' + record.aliases.join(' / ') + '）' : ''
    return '- [' + MEMORY_KIND_LABELS[record.kind] + ' | ' + where + ' | ' + importanceLabel(record.importance) + flag + '] '
      + record.title + alias + '：' + record.content.replace(/\n/g, ' ')
  }).join('\n')
}

const RECORD_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: MEMORY_KINDS },
    scope: { type: 'string', required: true, enum: ['global', 'project'] },
    projectPath: { type: 'string', required: true },
    title: { type: 'string', required: true },
    content: { type: 'string', required: true },
    summary: { type: 'string', required: true },
    aliases: { type: 'array', required: true, items: { type: 'string' } },
    importance: { type: 'number', required: true },
    tags: { type: 'array', required: true, items: { type: 'string' } },
    pinned: { type: 'boolean', required: true },
    archived: { type: 'boolean', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

/**
 * 实体项的输出 schema（memory_entity 的返回值形状，与 MemoryToolEntity 对齐）。
 */
const ENTITY_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: MEMORY_ENTITY_KINDS },
    kindLabel: { type: 'string', required: true },
    aliases: { type: 'array', required: true, items: { type: 'string' } },
    summary: { type: 'string', required: true },
    archived: { type: 'boolean', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

/** 边项的输出 schema（memory_link 的返回值形状，与 MemoryToolEdge 对齐）。 */
const EDGE_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    relation: { type: 'string', required: true, enum: MEMORY_EDGE_RELATIONS },
    relationLabel: { type: 'string', required: true },
    from: { type: 'string', required: true },
    to: { type: 'string', required: true },
    fromLabel: { type: 'string', required: true },
    toLabel: { type: 'string', required: true },
    note: { type: 'string', required: true },
    origin: { type: 'string', required: true, enum: MEMORY_EDGE_ORIGINS },
    weight: { type: 'number', required: true },
  },
} as const

/** 实体 → 工具返回的紧凑视图。 */
function describeEntity(entity: MemoryEntity): MemoryToolEntity {
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    kindLabel: MEMORY_ENTITY_KIND_LABELS[entity.kind],
    aliases: entity.aliases,
    summary: entity.summary,
    archived: entity.archived,
    updatedAt: new Date(entity.updatedAt).toISOString(),
  }
}

/** 边 → 工具返回的紧凑视图；端点标签取自 labels 索引，端点已删除时标注出来。 */
function describeEdge(edge: MemoryEdge, labels: Map<string, string>): MemoryToolEdge {
  const from = edge.from.kind + ':' + edge.from.id
  const to = edge.to.kind + ':' + edge.to.id
  return {
    id: edge.id,
    relation: edge.relation,
    relationLabel: MEMORY_EDGE_RELATION_LABELS[edge.relation],
    from,
    to,
    fromLabel: labels.get(from) ?? '(已删除)',
    toLabel: labels.get(to) ?? '(已删除)',
    note: edge.note,
    origin: edge.origin,
    weight: edge.weight,
  }
}

/** 端点标签索引：'memory:<id>' / 'entity:<id>' → 可读名字（含已归档，避免标签显示成已删除）。 */
async function labelIndex(svc: MemoryService): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const record of await svc.list({ includeArchived: true })) map.set('memory:' + record.id, record.title)
  for (const entity of await svc.listEntities({ includeArchived: true })) map.set('entity:' + entity.id, entity.name)
  return map
}

/** 按 id / 名称 / 别名精确解析一个实体（工具参数里直接写名字时用）。 */
async function resolveEntity(svc: MemoryService, ref: string): Promise<MemoryEntity | undefined> {
  const trimmed = ref.trim()
  const key = trimmed.toLowerCase()
  if (key === '') return undefined
  const all = await svc.listEntities({ includeArchived: true })
  return all.find((entity) => entity.id === trimmed
    || entity.name.trim().toLowerCase() === key
    || entity.aliases.some((alias) => alias.trim().toLowerCase() === key))
}

/**
 * scope=project 时的项目路径解析：优先用模型显式给出的路径，否则用会话 cwd 兜底。
 * 两者都没有时抛出可读错误（而不是静默写进全局，那会污染全局记忆）。
 */
export function resolveProjectPath(explicit: string | undefined, cwd: string | undefined): string {
  const trimmed = explicit?.trim() ?? ''
  if (trimmed !== '') return trimmed
  const fallback = cwd?.trim() ?? ''
  if (fallback !== '') return fallback
  throw new Error('project-scoped memory needs a project path; none was given and the session has no workspace cwd')
}

/** 本插件注册的全部工具名（与其它记忆插件做重名探测用）。 */
export const MEMORY_TOOL_NAMES = [
  TOOL_SAVE, TOOL_SEARCH, TOOL_LIST, TOOL_UPDATE, TOOL_DELETE, TOOL_ARCHIVE, TOOL_MOVE,
  TOOL_ENTITY, TOOL_LINK,
] as const

export interface InstallMemoryToolsOptions {
  /** 探测到的重名冲突（这些名字已被跳过，没有注册）。 */
  onConflicts?: (conflicts: MemoryConflict[]) => void
}

export function installMemoryTools(ctx: Context, options: InstallMemoryToolsOptions = {}): void {
  // 延后一个 macrotask 再注册：让同样在等 tools 就绪的插件（比如 dsh-mneme）先落地。
  // 否则「谁先跑谁占名」，后跑的那个会直接注册失败，探测就成了撞运气。
  const timer = setTimeout(() => { mountMemoryTools(ctx, options) }, 0)
  ctx.effect(() => () => { clearTimeout(timer) })
}

function mountMemoryTools(ctx: Context, options: InstallMemoryToolsOptions): void {
  const svc: MemoryService = ctx.memory

  // 重名硬冲突：tools 服务在同一层重复注册会直接抛错。装了 mneme 之类的记忆插件时
  // 7 个 memory_* 里多数会撞名 —— 此时本插件**整体让位**，一个工具都不注册，
  // 不留「部分可用」那种半吊子状态（冲突即锁定，见 service.isLocked）。
  const conflicts = detectToolConflicts(ctx.tools as unknown as ToolProbe | undefined, MEMORY_TOOL_NAMES)
  if (conflicts.length > 0) {
    options.onConflicts?.(conflicts)
    return
  }

  const register = (definition: ToolDefinition): void => {
    try {
      ctx.tools.register(definition)
    } catch {
      // 兜底：探测之后、注册之前的极窄窗口里冒出来的同名工具。
      conflicts.push({ name: definition.name, description: '' })
      ctx.logger?.warn?.('[plugin-memory] tool "' + definition.name + '" is already registered by another plugin — skipped')
    }
  }

  /* ----- 写：记录一条记忆 ----- */

  register(defineTool({
    name: TOOL_SAVE,
    description:
      // 为后续会话持久化一条记忆：用户偏好、身份、项目状态、决策。
      'Persist one memory entry for future sessions (user preferences, identity, project state, decisions). '
      // 标题相同、或正文高度重叠时会并入已有条目，重复写入不会产生多条。
      + 'Merges into an existing entry when the title matches or the body substantially overlaps, so repeated saves never duplicate. '
      // scope=global：换到任何项目都成立（语气、格式、风格、身份、广泛偏好）。
      + 'scope=global for anything true across projects (tone, format, style, identity, broad preferences); '
      // scope=project：只对某一个工作区成立（习惯、决策、环境细节）。
      + 'scope=project for habits/decisions that only hold for one workspace directory. '
      // 正文必须是单段纯文本、只写结论、≤320 字（合并后的总长也算）。
      + 'The body must be ONE plain paragraph of conclusion-only text, at most 320 characters (merged length counts too); '
      // 含换行、列表或超长会被拒写，不会静默截断。
      + 'line breaks, lists and over-limit bodies are rejected, not truncated. '
      // 不要记任务进度、进行中的快照、可重跑的验证结果（测试全过 / tsc 干净 / build 成功）。
      + 'Skip task progress, in-flight snapshots and re-runnable verification results (tests pass / tsc clean / build ok). '
      // 用 entities 声明这条记忆讲的实体（项目/工具/人/概念）：命中已有实体则复用，未命中按名称新建，并落一条 about 边。
      + 'Pass entities to declare what this memory is about (project / tool / person / concept names): each name is matched against existing entities or created, then linked with an about edge. '
      // aliases 是同一条记忆的别的说法：之后用别名当标题写入会并进这一条，而不是另起一条。
      + 'aliases are alternative spellings of this same entry, so a later save titled with an alias merges here instead of creating a duplicate. '
      // summary 是一行摘要（目录卡 / 关联视图用）；正文仍要写完整结论。
      + 'summary is a one-line abstract for catalog and relation views; the body still carries the full conclusion.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short unique title; the dedup key within a scope.' },
      content: { type: 'string', required: true, description: 'One plain paragraph, conclusion-only, <=320 chars, no line breaks or lists (hard cap).' },
      scope: {
        type: 'string',
        required: true,
        enum: ['global', 'project'],
        description: 'global = cross-project; project = only this workspace. You must decide.',
      },
      kind: { type: 'string', enum: MEMORY_KINDS, description: 'Memory category (default fact).' },
      project_path: { type: 'string', description: 'Workspace directory for scope=project; defaults to the session cwd.' },
      summary: { type: 'string', description: 'One-line abstract for catalog and relation views.' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'Alternative spellings of this same entry (they become merge targets).' },
      entities: { type: 'array', items: { type: 'string' }, description: 'Entity names this memory is about (project / tool / person / concept); matched or created, then linked.' },
      importance: { type: 'integer', description: '1-5; >= the injection threshold gets auto-injected later.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: RECORD_ITEM_SCHEMA,
          created: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const v = value as { saved: Record<string, unknown>; created: boolean }
        return [{ type: 'text', text: (v.created ? '记忆已保存：' : '记忆已合并更新：') + String(v.saved.title) }]
      },
    },
    async execute(args, exec) {
      const session = sessionContextOf(exec)
      const scope = args.scope as MemoryScope
      const projectPath = scope === 'project' ? resolveProjectPath(args.project_path as string | undefined, session.cwd) : undefined
      // created 由服务端的落点决定：语义重叠并入时也是 false（提示「已合并更新」，
      // 而不是「已保存」——模型据此知道这条并进了已有条目）。
      const outcome = await svc.saveWithOutcome({
        title: args.title as string,
        content: args.content as string,
        scope,
        ...(projectPath !== undefined ? { projectPath } : {}),
        ...(args.kind !== undefined ? { kind: args.kind as MemoryKind } : {}),
        ...(args.summary !== undefined ? { summary: args.summary as string } : {}),
        ...(Array.isArray(args.aliases) ? { aliases: args.aliases as string[] } : {}),
        ...(Array.isArray(args.entities) ? { entities: args.entities as string[] } : {}),
        ...(args.importance !== undefined ? { importance: args.importance as number } : {}),
        ...(Array.isArray(args.tags) ? { tags: args.tags as string[] } : {}),
        source: 'agent',
        ...(session.sessionId !== undefined ? { sessionId: session.sessionId } : {}),
      })
      return { saved: describeRecord(outcome.record), created: outcome.created }
    },
  }))

  /* ----- 读：搜索 ----- */

  register(defineTool({
    name: TOOL_SEARCH,
    description: 'Search the cross-session memory store (substring match over title/content/tags). '
      + 'Use when you need past context: how a problem was solved, user preferences, project decisions.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search text.' },
      scope: { type: 'string', enum: ['global', 'project'], description: 'Limit to one scope.' },
      project_path: { type: 'string', description: 'Limit project memories to this workspace (defaults to the session cwd).' },
      include_archived: { type: 'boolean', description: 'Also search archived entries (default false).' },
      limit: { type: 'integer', description: 'Max results (default 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          records: { type: 'array', required: true, items: RECORD_ITEM_SCHEMA },
          count: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const v = value as { records: MemoryToolRecord[]; count: number }
        return [{ type: 'text', text: v.count === 0 ? '(no matching memories)' : render(v.records, '') }]
      },
    },
    async execute(args, exec) {
      const session = sessionContextOf(exec)
      const explicit = args.project_path as string | undefined
      const projectPath = explicit !== undefined
        ? explicit
        : (args.scope === 'project' ? session.cwd : undefined)
      const records = await svc.list({
        keyword: args.query as string,
        ...(args.scope !== undefined ? { scope: args.scope as MemoryScope } : {}),
        ...(projectPath !== undefined ? { projectPath } : {}),
        ...(args.include_archived === true ? { includeArchived: true } : {}),
        limit: args.limit !== undefined ? (args.limit as number) : 20,
      })
      return { records: records.map(describeRecord), count: records.length }
    },
  }))

  /* ----- 读：列出 ----- */

  register(defineTool({
    name: TOOL_LIST,
    description: 'List memories by scope/kind, highest importance first. Use include_archived=true to see archived entries.',
    parameters: {
      scope: { type: 'string', enum: ['global', 'project'], description: 'Limit to one scope.' },
      project_path: { type: 'string', description: 'Limit project memories to this workspace (defaults to the session cwd).' },
      kind: { type: 'string', enum: MEMORY_KINDS, description: 'Limit to one category.' },
      include_archived: { type: 'boolean', description: 'Include archived entries (default false).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          records: { type: 'array', required: true, items: RECORD_ITEM_SCHEMA },
          count: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const v = value as { records: MemoryToolRecord[]; count: number }
        return [{ type: 'text', text: v.count === 0 ? '(no memories)' : render(v.records, '') }]
      },
    },
    async execute(args, exec) {
      const session = sessionContextOf(exec)
      const explicit = args.project_path as string | undefined
      const projectPath = explicit !== undefined
        ? explicit
        : (args.scope === 'project' ? session.cwd : undefined)
      const records = await svc.list({
        ...(args.scope !== undefined ? { scope: args.scope as MemoryScope } : {}),
        ...(projectPath !== undefined ? { projectPath } : {}),
        ...(args.kind !== undefined ? { kind: args.kind as MemoryKind } : {}),
        ...(args.include_archived === true ? { includeArchived: true } : {}),
      })
      return { records: records.map(describeRecord), count: records.length }
    },
  }))

  /* ----- 写：修改 ----- */

  register(defineTool({
    name: TOOL_UPDATE,
    description: 'Modify an existing memory entry (title / content / summary / aliases / kind / scope / importance / tags / pinned). '
      // 只改传入的字段；summary 与 aliases 是整体替换（不是追加）。
      + 'Only the fields you pass change; summary and aliases replace those fields.',
    parameters: {
      id: { type: 'string', required: true, description: 'Memory id from memory_search / memory_list.' },
      title: { type: 'string', description: 'New title.' },
      content: { type: 'string', description: 'New body.' },
      summary: { type: 'string', description: 'New one-line abstract.' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'Replacement aliases.' },
      kind: { type: 'string', enum: MEMORY_KINDS, description: 'New category.' },
      importance: { type: 'integer', description: 'New importance 1-5.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tags.' },
      pinned: { type: 'boolean', description: 'Pin or unpin.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          updated: { type: 'boolean', required: true },
          record: RECORD_ITEM_SCHEMA,
        },
      },
      render: (_args, value) => {
        const v = value as { updated: boolean; record?: { title?: unknown } }
        if (!v.updated) return [{ type: 'text', text: '未找到该记忆。' }]
        return [{ type: 'text', text: '记忆已更新：' + String(v.record?.title ?? '') }]
      },
    },
    async execute(args) {
      const updated = await svc.updateMemory(args.id as MemoryId, {
        ...(args.title !== undefined ? { title: args.title as string } : {}),
        ...(args.content !== undefined ? { content: args.content as string } : {}),
        ...(args.summary !== undefined ? { summary: args.summary as string } : {}),
        ...(Array.isArray(args.aliases) ? { aliases: args.aliases as string[] } : {}),
        ...(args.kind !== undefined ? { kind: args.kind as MemoryKind } : {}),
        ...(args.importance !== undefined ? { importance: args.importance as number } : {}),
        ...(Array.isArray(args.tags) ? { tags: args.tags as string[] } : {}),
        ...(args.pinned !== undefined ? { pinned: args.pinned as boolean } : {}),
      })
      return updated === undefined
        ? { updated: false }
        : { updated: true, record: describeRecord(updated) }
    },
  }))

  /* ----- 写：删除 ----- */

  register(defineTool({
    name: TOOL_DELETE,
    description: 'Permanently delete one memory entry by id. Prefer memory_archive when the entry may still be useful.',
    parameters: {
      id: { type: 'string', required: true, description: 'Memory id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { deleted: { type: 'boolean', required: true } },
      },
      render: (_args, value) => {
        const v = value as { deleted: boolean }
        return [{ type: 'text', text: v.deleted ? '记忆已删除。' : '未找到该记忆。' }]
      },
    },
    async execute(args) {
      return { deleted: await svc.removeMemory(args.id as MemoryId) }
    },
  }))

  /* ----- 写：归档 / 恢复 ----- */

  register(defineTool({
    name: TOOL_ARCHIVE,
    description: 'Archive a memory (hidden from lists/search/injection, still recoverable) or restore it with archived=false.',
    parameters: {
      id: { type: 'string', required: true, description: 'Memory id.' },
      archived: { type: 'boolean', description: 'true archives (default), false restores.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { archived: { type: 'boolean', required: true } },
      },
      render: (_args, value) => {
        const v = value as { archived: boolean }
        return [{ type: 'text', text: v.archived ? '记忆已归档。' : '记忆已恢复。' }]
      },
    },
    async execute(args) {
      const archived = args.archived !== false
      const result = await svc.setArchived(args.id as MemoryId, archived)
      return { archived: result === undefined ? false : result.archived }
    },
  }))

  /* ----- 写：移动（全局 ⇄ 项目）----- */

  register(defineTool({
    name: TOOL_MOVE,
    description: 'Move a memory between global and project scope. Use when a memory was filed at the wrong level '
      + '(e.g. a one-project habit landed in global, or a broad preference landed in a project).',
    parameters: {
      id: { type: 'string', required: true, description: 'Memory id.' },
      scope: { type: 'string', required: true, enum: ['global', 'project'], description: 'Target scope.' },
      project_path: { type: 'string', description: 'Target workspace directory when scope=project; defaults to the session cwd.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          moved: { type: 'boolean', required: true },
          record: RECORD_ITEM_SCHEMA,
        },
      },
      render: (_args, value) => {
        const v = value as { moved: boolean; record?: { title?: unknown } }
        if (!v.moved) return [{ type: 'text', text: '未找到该记忆。' }]
        return [{ type: 'text', text: '记忆已移动：' + String(v.record?.title ?? '') }]
      },
    },
    async execute(args, exec) {
      const session = sessionContextOf(exec)
      const scope = args.scope as MemoryScope
      const projectPath = scope === 'project' ? resolveProjectPath(args.project_path as string | undefined, session.cwd) : undefined
      const updated = await svc.updateMemory(args.id as MemoryId, {
        scope,
        ...(projectPath !== undefined ? { projectPath } : {}),
      })
      return updated === undefined
        ? { moved: false }
        : { moved: true, record: describeRecord(updated) }
    },
  }))

  /* ----- 实体（wiki 图层）----- */

  register(defineTool({
    name: TOOL_ENTITY,
    description:
      // 管理实体：记忆库里可复用的「名词」（项目 / 工具 / 人物 / 组织 / 概念）。
      'Manage entities: the reusable nouns of the memory graph (project / tool / person / org / concept). '
      // upsert：命中同名或同别名的已有实体就并入（补别名与摘要），否则新建一条。
      + 'action=upsert creates or merges one by name — an existing entity with the same name or alias is merged, never duplicated. '
      // list：按关键字列实体；remove：删掉这个实体连同挂在它身上的所有边。
      + 'action=list lists entities by keyword; action=remove deletes one together with all of its edges. '
      // 实体名出现在记忆的标题或标签里 → about 边（关于它）；只出现在正文里 → mentions 边（提及）。
      + 'An entity name in a memory title or tags links it with an about edge; a name only in the body links with a mentions edge. '
      // 共享同一实体的两条记忆会自动连成 related，不需要手工连边。
      + 'Memories that share an entity are automatically linked as related — no manual linking needed.',
    parameters: {
      action: { type: 'string', required: true, enum: ['upsert', 'list', 'remove'], description: 'upsert | list | remove.' },
      id: { type: 'string', description: 'Entity id (upsert: update this one; remove: which one).' },
      name: { type: 'string', description: 'Entity name (upsert: required).' },
      kind: { type: 'string', enum: MEMORY_ENTITY_KINDS, description: 'Entity category (default concept).' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'Other spellings of the same entity (they trigger linkage too).' },
      summary: { type: 'string', description: 'One-line description of the entity.' },
      keyword: { type: 'string', description: 'list: substring match over name / aliases / summary.' },
      include_archived: { type: 'boolean', description: 'list: include archived entities.' },
      limit: { type: 'integer', description: 'list: max rows (default 50).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          entity: ENTITY_ITEM_SCHEMA,
          entities: { type: 'array', required: true, items: ENTITY_ITEM_SCHEMA },
        },
      },
      render: (_args, value) => {
        const v = value as { message: string; entities: MemoryToolEntity[] }
        const lines = [v.message]
        for (const entity of v.entities) {
          const alias = entity.aliases.length > 0 ? '（别名：' + entity.aliases.join(' / ') + '）' : ''
          const summary = entity.summary !== '' ? ' — ' + entity.summary : ''
          lines.push('- [' + entity.kindLabel + '] ' + entity.name + alias + summary)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const action = args.action as string
      if (action === 'remove') {
        const id = (args.id as string | undefined)?.trim() ?? ''
        if (id === '') return { ok: false, message: '删除实体需要 id。', entities: [] }
        const removed = await svc.removeEntity(id as MemoryEntityId)
        return { ok: removed, message: removed ? '实体已删除（连同它的边）。' : '未找到该实体。', entities: [] }
      }
      if (action === 'list') {
        const entities = await svc.listEntities({
          ...(args.keyword !== undefined ? { keyword: args.keyword as string } : {}),
          ...(args.kind !== undefined ? { kind: args.kind as MemoryEntityKind } : {}),
          ...(args.include_archived === true ? { includeArchived: true } : {}),
          limit: args.limit !== undefined ? (args.limit as number) : 50,
        })
        return {
          ok: true,
          message: entities.length === 0 ? '(没有匹配的实体)' : '实体 ' + entities.length + ' 个：',
          entities: entities.map(describeEntity),
        }
      }
      const name = (args.name as string | undefined)?.trim() ?? ''
      if (name === '') return { ok: false, message: 'upsert 需要 name。', entities: [] }
      const entity = await svc.upsertEntity({
        name,
        ...(args.id !== undefined ? { id: args.id as string } : {}),
        ...(args.kind !== undefined ? { kind: args.kind as MemoryEntityKind } : {}),
        ...(Array.isArray(args.aliases) ? { aliases: args.aliases as string[] } : {}),
        ...(args.summary !== undefined ? { summary: args.summary as string } : {}),
      })
      return {
        ok: true,
        message: '实体已保存：' + entity.name,
        entity: describeEntity(entity),
        entities: [describeEntity(entity)],
      }
    },
  }))

  /* ----- 边（wiki 图层）----- */

  register(defineTool({
    name: TOOL_LINK,
    description:
      // 在两个节点之间连一条有语义的边：自动推导只覆盖「提及 / 共现」，其余关系要显式连。
      'Link two nodes in the memory graph when the relationship itself matters — auto-derived edges only cover mentions and co-occurrence. '
      // 关系取值：about 关于 / mentions 提及 / related 相关 / refines 细化 / supersedes 取代 / contradicts 冲突 / part-of 属于 / uses 使用 / same-as 同义。
      + 'Relations: ' + MEMORY_EDGE_RELATIONS.join(' / ') + '. '
      // 幂等：同端点 + 同关系只有一条边，重复连只会更新备注；对称关系（related 等）两个方向视为同一条。
      + 'Linking is idempotent: same endpoints and relation reuse one edge, so re-linking only updates the note. '
      // list：给 memory_id 看一条记忆的全部关联（含自动边）；unlink：给 edge_id 断边。
      + 'action=list with memory_id shows everything one memory is linked to (including auto edges); action=unlink with edge_id removes one.',
    parameters: {
      action: { type: 'string', required: true, enum: ['link', 'unlink', 'list'], description: 'link | unlink | list.' },
      from: { type: 'string', description: 'link: source memory id (must exist).' },
      to: { type: 'string', description: 'link: target — an entity name or id when to_kind=entity, otherwise a memory id.' },
      to_kind: { type: 'string', enum: ['memory', 'entity'], description: 'link: target kind (default entity).' },
      relation: { type: 'string', enum: MEMORY_EDGE_RELATIONS, description: 'link: relation (default about for an entity, related for a memory).' },
      note: { type: 'string', description: 'link: why these two are related.' },
      edge_id: { type: 'string', description: 'unlink: the edge id returned by action=list.' },
      memory_id: { type: 'string', description: 'list: show this memory and everything it is linked to.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          edges: { type: 'array', required: true, items: EDGE_ITEM_SCHEMA },
        },
      },
      render: (_args, value) => {
        const v = value as { message: string; edges: MemoryToolEdge[] }
        const lines = [v.message]
        for (const edge of v.edges) {
          const note = edge.note !== '' ? '（' + edge.note + '）' : ''
          lines.push('- ' + edge.fromLabel + ' --' + edge.relationLabel + '--> ' + edge.toLabel
            + ' [' + edge.origin + ']' + note)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const action = args.action as string
      if (action === 'unlink') {
        const edgeId = (args.edge_id as string | undefined)?.trim() ?? ''
        if (edgeId === '') return { ok: false, message: 'unlink 需要 edge_id。', edges: [] }
        const removed = await svc.unlink(edgeId)
        return { ok: removed, message: removed ? '边已断开。' : '未找到该边。', edges: [] }
      }
      if (action === 'list') {
        const memoryId = (args.memory_id as string | undefined)?.trim() ?? ''
        if (memoryId === '') return { ok: false, message: 'list 需要 memory_id。', edges: [] }
        const view = await svc.neighborhood(memoryId as MemoryId)
        if (view === undefined) return { ok: false, message: '未找到该记忆。', edges: [] }
        const labels = await labelIndex(svc)
        return {
          ok: true,
          message: view.edges.length === 0 ? '该记忆暂无关联。' : '共 ' + view.edges.length + ' 条关联：',
          edges: view.edges.map((edge) => describeEdge(edge, labels)),
        }
      }
      const fromId = (args.from as string | undefined)?.trim() ?? ''
      if (fromId === '') return { ok: false, message: 'link 需要 from（记忆 id）。', edges: [] }
      const toRaw = (args.to as string | undefined)?.trim() ?? ''
      if (toRaw === '') return { ok: false, message: 'link 需要 to。', edges: [] }
      const toKind = (args.to_kind as string | undefined) ?? 'entity'
      let to: MemoryNodeRef
      if (toKind === 'memory') {
        to = { kind: 'memory', id: toRaw }
      } else {
        const entity = await resolveEntity(svc, toRaw)
        if (entity === undefined) {
          return {
            ok: false,
            message: '没有这个实体：' + toRaw + '。先用 memory_entity action=upsert 落一个，或改用已有实体的名称。',
            edges: [],
          }
        }
        to = { kind: 'entity', id: entity.id }
      }
      try {
        const edge = await svc.link({
          from: { kind: 'memory', id: fromId },
          to,
          ...(args.relation !== undefined ? { relation: args.relation as MemoryEdgeRelation } : {}),
          ...(args.note !== undefined ? { note: args.note as string } : {}),
          origin: 'agent',
        })
        const labels = await labelIndex(svc)
        return {
          ok: true,
          message: '已连边：' + MEMORY_EDGE_RELATION_LABELS[edge.relation],
          edges: [describeEdge(edge, labels)],
        }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error), edges: [] }
      }
    },
  }))

  // 全部注册完成后再统一上报：探测到的 + 注册时撞到的。
  options.onConflicts?.(conflicts)
}
