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
import type { MemoryConflict, MemoryId, MemoryKind, MemoryRecord, MemoryScope } from '../types.ts'
import { MEMORY_KINDS, MEMORY_KIND_LABELS, importanceLabel } from '../types.ts'
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
    importance: record.importance,
    tags: record.tags,
    pinned: record.pinned,
    archived: record.archived,
    updatedAt: new Date(record.updatedAt).toISOString(),
  }
}

function render(records: readonly MemoryToolRecord[], emptyHint: string): string {
  if (records.length === 0) return emptyHint
  return records.map((record) => {
    const where = record.scope === 'global' ? '全局' : '项目:' + projectLabelOf(record.projectPath)
    const flag = record.archived ? ' [已归档]' : ''
    return '- [' + MEMORY_KIND_LABELS[record.kind] + ' | ' + where + ' | ' + importanceLabel(record.importance) + flag + '] '
      + record.title + '：' + record.content.replace(/\n/g, ' ')
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
    importance: { type: 'number', required: true },
    tags: { type: 'array', required: true, items: { type: 'string' } },
    pinned: { type: 'boolean', required: true },
    archived: { type: 'boolean', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

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
      'Persist one memory entry for future sessions (user preferences, identity, project state, decisions). '
      + 'Merges into an existing entry when the title matches, so repeated saves never duplicate. '
      + 'scope=global for anything true across projects (tone, format, style, identity, broad preferences); '
      + 'scope=project for habits/decisions that only hold for one workspace directory. '
      + 'Keep the body short and conclusion-only: it is capped at 800 characters (the merged length counts too) '
      + 'and an over-limit save is rejected, not truncated. Skip task progress, in-flight snapshots, and '
      + 're-runnable verification results (tests pass / tsc clean / build ok).',
    parameters: {
      title: { type: 'string', required: true, description: 'Short unique title; the dedup key within a scope.' },
      content: { type: 'string', required: true, description: 'The memory body, in the user\'s own wording when possible. Conclusion-only, <=800 chars (hard cap).' },
      scope: {
        type: 'string',
        required: true,
        enum: ['global', 'project'],
        description: 'global = cross-project; project = only this workspace. You must decide.',
      },
      kind: { type: 'string', enum: MEMORY_KINDS, description: 'Memory category (default fact).' },
      project_path: { type: 'string', description: 'Workspace directory for scope=project; defaults to the session cwd.' },
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
      const before = await svc.list({
        scope,
        ...(projectPath !== undefined ? { projectPath } : {}),
        includeArchived: true,
      })
      const existingTitles = new Set(before.map((record) => record.title.trim().toLowerCase()))
      const saved = await svc.save({
        title: args.title as string,
        content: args.content as string,
        scope,
        ...(projectPath !== undefined ? { projectPath } : {}),
        ...(args.kind !== undefined ? { kind: args.kind as MemoryKind } : {}),
        ...(args.importance !== undefined ? { importance: args.importance as number } : {}),
        ...(Array.isArray(args.tags) ? { tags: args.tags as string[] } : {}),
        source: 'agent',
        ...(session.sessionId !== undefined ? { sessionId: session.sessionId } : {}),
      })
      const created = !existingTitles.has((args.title as string).trim().toLowerCase())
      return { saved: describeRecord(saved), created }
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
    description: 'Modify an existing memory entry (title / content / kind / scope / importance / tags / pinned). '
      + 'Only the fields you pass change.',
    parameters: {
      id: { type: 'string', required: true, description: 'Memory id from memory_search / memory_list.' },
      title: { type: 'string', description: 'New title.' },
      content: { type: 'string', description: 'New body.' },
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

  // 全部注册完成后再统一上报：探测到的 + 注册时撞到的。
  options.onConflicts?.(conflicts)
}
