import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  MemoryConflict, MemoryEdge, MemoryEdgeOrigin, MemoryEdgeRelation, MemoryEntity, MemoryEntityId,
  MemoryEntityKind, MemoryEntityRef, MemoryId, MemoryKind, MemoryNodeRef, MemoryRecord, MemoryScope,
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
export const TOOL_ENTITY = MEMORY_TOOL_PREFIX + 'entity'
export const TOOL_LINK = MEMORY_TOOL_PREFIX + 'link'
export const SUSPECT_HINT_PREFIX = '疑似同一条：'

export function isMemoryTool(name: string): boolean {
  return name.startsWith(MEMORY_TOOL_PREFIX)
}

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

function render(records: readonly MemoryToolRecord[], emptyHint: string): string {
  if (records.length === 0) return emptyHint
  return records.map((record) => {
    const where = record.scope === 'global' ? '全局' : '项目:' + projectLabelOf(record.projectPath)
    const flag = record.archived ? ' [已归档]' : ''
    const alias = record.aliases.length > 0 ? '（别名：' + record.aliases.join(' / ') + '）' : ''
    return '- [' + MEMORY_KIND_LABELS[record.kind] + ' | ' + where + ' | ' + importanceLabel(record.importance) + flag + '] '
      + record.title + alias + '：' + record.content.replace(/\n/g, '\n  ')
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

async function labelIndex(svc: MemoryService): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const record of await svc.list({ includeArchived: true })) map.set('memory:' + record.id, record.title)
  for (const entity of await svc.listEntities({ includeArchived: true })) map.set('entity:' + entity.id, entity.name)
  return map
}

/**
 * schema 里的 oneOf 不是信任边界，运行时照样逐项收窄。
 */
function parseEntityRefs(raw: readonly unknown[]): (string | MemoryEntityRef)[] {
  const out: (string | MemoryEntityRef)[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push(item)
      continue
    }
    if (item === null || typeof item !== 'object') continue
    const record = item as { name?: unknown; kind?: unknown }
    if (typeof record.name !== 'string') continue
    const kind = MEMORY_ENTITY_KINDS.find((candidate) => candidate === record.kind)
    out.push(kind === undefined ? { name: record.name } : { name: record.name, kind })
  }
  return out
}

async function resolveEntity(svc: MemoryService, ref: string): Promise<MemoryEntity | undefined> {
  const trimmed = ref.trim()
  const key = trimmed.toLowerCase()
  if (key === '') return undefined
  const all = await svc.listEntities({ includeArchived: true })
  return all.find((entity) => entity.id === trimmed
    || entity.name.trim().toLowerCase() === key
    || entity.aliases.some((alias) => alias.trim().toLowerCase() === key))
}

export function resolveProjectPath(explicit: string | undefined, cwd: string | undefined): string {
  const trimmed = explicit?.trim() ?? ''
  if (trimmed !== '') return trimmed
  const fallback = cwd?.trim() ?? ''
  if (fallback !== '') return fallback
  throw new Error('project 作用域的记忆需要项目路径：既没有显式给出，会话也没有工作区 cwd')
}

export const MEMORY_TOOL_NAMES = [
  TOOL_SAVE, TOOL_SEARCH, TOOL_LIST, TOOL_UPDATE, TOOL_DELETE, TOOL_ARCHIVE, TOOL_MOVE,
  TOOL_ENTITY, TOOL_LINK,
] as const

export interface InstallMemoryToolsOptions {
  onConflicts?: (conflicts: MemoryConflict[]) => void
}

export function renderSaveResult(v: {
  readonly saved: Record<string, unknown>
  readonly created: boolean
  readonly merged_by?: string
  readonly skipped?: boolean
  readonly judge_reason?: string
  readonly suspect_title?: string
  readonly suspect_score?: number
}): string {
  const title = String(v.saved.title)
  const lines: string[] = []
  if (v.skipped === true) {
    lines.push('没有写入：已有『' + title + '』完整覆盖了这条（模型判定）。')
  } else if (v.created) {
    lines.push('记忆已保存：' + title)
  } else if (v.merged_by === 'judge') {
    lines.push('记忆已并入已有条目（模型判定）：' + title)
  } else {
    lines.push('记忆已合并更新：' + title)
  }
  if (v.judge_reason !== undefined && v.judge_reason !== '') lines.push('判定理由：' + v.judge_reason)
  if (v.suspect_title !== undefined) {
    const score = typeof v.suspect_score === 'number' ? v.suspect_score.toFixed(2) : '?'
    lines.push(SUSPECT_HINT_PREFIX + '已有『' + v.suspect_title + '』（相似度 ' + score + '）像是同一件事，但没有自动合并。'
      + '确认是同一条：用 memory_update 把新信息改到那一条上，再用 memory_delete 删掉这条；'
      + '只是相关：用 memory_link 把两条连起来。')
  }
  return lines.join('\n')
}

export function installMemoryTools(ctx: Context, options: InstallMemoryToolsOptions = {}): void {
  // 延后一个 macrotask：让别的等 tools 的插件先注册。
  const timer = setTimeout(() => { mountMemoryTools(ctx, options) }, 0)
  ctx.effect(() => () => { clearTimeout(timer) })
}

function mountMemoryTools(ctx: Context, options: InstallMemoryToolsOptions): void {
  const svc: MemoryService = ctx.memory

  const conflicts = detectToolConflicts(ctx.tools as unknown as ToolProbe | undefined, MEMORY_TOOL_NAMES)
  if (conflicts.length > 0) {
    options.onConflicts?.(conflicts)
    return
  }

  const register = (definition: ToolDefinition): void => {
    try {
      ctx.tools.register(definition)
    } catch {
      conflicts.push({ name: definition.name, description: '' })
      ctx.logger?.warn?.('[plugin-memory] tool "' + definition.name + '" is already registered by another plugin — skipped')
    }
  }

  register(defineTool({
    name: TOOL_SAVE,
    description:
      '保存一条记忆，供未来的会话使用（用户偏好、身份、项目状态、决策）。'
      + '标题相同或正文高度重合时并入已有条目，反复保存也不会出现重复。'
      + '附近已有相似条目时，由模型裁判判定一次是新增、并入其中一条还是跳过，结果里会说明理由。'
      + '跨项目都成立的写 scope=global（语气、格式、风格、身份、广泛偏好）；'
      + '只对某一个工作区成立的习惯与决策写 scope=project。'
      + '正文只写结论，最多 320 字（合并后的总长同样计入）；可以换行和使用 markdown 列表。'
      + '超出上限的正文会被整条拒绝，不会截断。'
      + '不要写任务进度、进行中的快照、可重跑得到的验证结果（测试全过 / tsc 干净 / build 成功）。'
      + '用 entities 声明这条记忆讲的是谁：每个名字先匹配已有实体，匹配不到就新建，然后连一条 about 边。'
      + '能判断就给出实体 kind（project / tool / person / org / concept），缺省是 concept，省掉就丢掉了这个区分。'
      + 'aliases 是同一条目的其他写法，之后用别名作标题保存会并入这里，而不是新建重复条目。'
      + 'summary 是目录与关联视图用的一句话摘要；结论的全文仍放在正文里。',
    parameters: {
      title: { type: 'string', required: true, description: '短而唯一的标题，同一作用域内的去重键。' },
      content: { type: 'string', required: true, description: '只写结论，最多 320 字（硬上限）；可以换行和使用 markdown 列表。' },
      scope: {
        type: 'string',
        required: true,
        enum: ['global', 'project'],
        description: 'global=跨项目成立；project=只对当前工作区成立。必须自己判断。',
      },
      kind: { type: 'string', enum: MEMORY_KINDS, description: '记忆类别（缺省 fact）。' },
      project_path: { type: 'string', description: 'scope=project 时的工作区目录，缺省用会话 cwd。' },
      summary: { type: 'string', description: '目录与关联视图用的一句话摘要。' },
      aliases: { type: 'array', items: { type: 'string' }, description: '同一条目的其他写法（会成为合并目标）。' },
      entities: {
        type: 'array',
        description: '这条记忆讲到的实体：直接给名字，或已知类别时给 { name, kind }。',
        items: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true, description: '实体名。' },
                kind: { type: 'string', enum: MEMORY_ENTITY_KINDS, description: '实体类别。确实判断不出时才省略。' },
              },
            },
          ],
        },
      },
      importance: { type: 'integer', description: '1-5；达到注入阈值后会被自动注入。' },
      tags: { type: 'array', items: { type: 'string' }, description: '可选标签。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: RECORD_ITEM_SCHEMA,
          created: { type: 'boolean', required: true },
          merged_by: { type: 'string' },
          skipped: { type: 'boolean' },
          judge_reason: { type: 'string' },
          suspect_title: { type: 'string' },
          suspect_score: { type: 'number' },
        },
      },
      render: (_args, value) => {
        const v = value as {
          saved: Record<string, unknown>
          created: boolean
          merged_by?: string
          skipped?: boolean
          judge_reason?: string
          suspect_title?: string
          suspect_score?: number
        }
        const title = String(v.saved.title)
        const lines: string[] = []
        if (v.skipped === true) {
          lines.push('没有写入：已有『' + title + '』完整覆盖了这条（模型判定）。')
        } else if (v.created) {
          lines.push('记忆已保存：' + title)
        } else if (v.merged_by === 'judge') {
          lines.push('记忆已并入已有条目（模型判定）：' + title)
        } else {
          lines.push('记忆已合并更新：' + title)
        }
        if (v.judge_reason !== undefined && v.judge_reason !== '') {
          lines.push('判定理由：' + v.judge_reason)
        }
        if (v.suspect_title !== undefined) {
          const score = typeof v.suspect_score === 'number' ? v.suspect_score.toFixed(2) : '?'
          lines.push(SUSPECT_HINT_PREFIX + '已有『' + v.suspect_title + '』（相似度 ' + score + '）像是同一件事，但没有自动合并。'
            + '确认是同一条：用 memory_update 把新信息改到那一条上，再用 memory_delete 删掉这条；'
            + '只是相关：用 memory_link 把两条连起来。')
        }
        return [{ type: 'text', text: renderSaveResult(v) }]
      },
    },
    async execute(args, exec) {
      const session = sessionContextOf(exec)
      const scope = args.scope as MemoryScope
      const projectPath = scope === 'project' ? resolveProjectPath(args.project_path as string | undefined, session.cwd) : undefined
      const outcome = await svc.saveWithOutcome({
        title: args.title as string,
        content: args.content as string,
        scope,
        ...(projectPath !== undefined ? { projectPath } : {}),
        ...(args.kind !== undefined ? { kind: args.kind as MemoryKind } : {}),
        ...(args.summary !== undefined ? { summary: args.summary as string } : {}),
        ...(Array.isArray(args.aliases) ? { aliases: args.aliases as string[] } : {}),
        ...(Array.isArray(args.entities) ? { entities: parseEntityRefs(args.entities) } : {}),
        ...(args.importance !== undefined ? { importance: args.importance as number } : {}),
        ...(Array.isArray(args.tags) ? { tags: args.tags as string[] } : {}),
        source: 'agent',
        ...(session.sessionId !== undefined ? { sessionId: session.sessionId } : {}),
      })
      return {
        saved: describeRecord(outcome.record),
        created: outcome.created,
        ...(outcome.mergedBy !== undefined ? { merged_by: outcome.mergedBy } : {}),
        ...(outcome.skipped === true ? { skipped: true } : {}),
        ...(outcome.judged?.reason !== undefined ? { judge_reason: outcome.judged.reason } : {}),
        ...(outcome.suspect !== undefined
          ? { suspect_title: outcome.suspect.title, suspect_score: Math.round(outcome.suspect.score * 100) / 100 }
          : {}),
      }
    },
  }))

  register(defineTool({
    name: TOOL_SEARCH,
    description:
      '跨会话检索记忆库：在标题、正文、摘要、别名、标签上做子串匹配（大小写不敏感）。'
      + '需要过去的上下文时用它：某个问题当时怎么解决的、说过的偏好、做过的项目决策。'
      + '命中别名等同于命中该条目；换了说法没搜到时，换一组关键词再试。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词。' },
      scope: { type: 'string', enum: ['global', 'project'], description: '限定在一个作用域内。' },
      project_path: { type: 'string', description: '把项目记忆限定在这个工作区（缺省用会话 cwd）。' },
      include_archived: { type: 'boolean', description: '连已归档的条目一起搜（缺省 false）。' },
      limit: { type: 'integer', description: '最多返回几条（缺省 20）。' },
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
        return [{ type: 'text', text: v.count === 0 ? '（没有匹配的记忆）' : render(v.records, '') }]
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

  register(defineTool({
    name: TOOL_LIST,
    description:
      '按作用域 / 类别列出记忆，置顶与高重要性的排在前面。'
      + '想一次看完某个作用域下都记了什么时用它；只要相关的那几条就用 memory_search。'
      + '已归档的条目只在 include_archived=true 时出现。',
    parameters: {
      scope: { type: 'string', enum: ['global', 'project'], description: '限定在一个作用域内。' },
      project_path: { type: 'string', description: '把项目记忆限定在这个工作区（缺省用会话 cwd）。' },
      kind: { type: 'string', enum: MEMORY_KINDS, description: '限定在一个类别内。' },
      include_archived: { type: 'boolean', description: '连已归档的条目一起列出（缺省 false）。' },
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
        return [{ type: 'text', text: v.count === 0 ? '（暂无记忆）' : render(v.records, '') }]
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

  register(defineTool({
    name: TOOL_UPDATE,
    description:
      '修改一条已有记忆（title / content / summary / aliases / kind / scope / importance / tags / pinned）。'
      + '只改你传进来的字段，其余保持原样。'
      + 'summary 与 aliases 是整字段替换而非追加；条目过时或写错了在这里改，不要另存一条新的。',
    parameters: {
      id: { type: 'string', required: true, description: '记忆 id，来自 memory_search / memory_list。' },
      title: { type: 'string', description: '新标题。' },
      content: { type: 'string', description: '新正文。' },
      summary: { type: 'string', description: '新的一句话摘要。' },
      aliases: { type: 'array', items: { type: 'string' }, description: '替换用的别名。' },
      kind: { type: 'string', enum: MEMORY_KINDS, description: '新类别。' },
      importance: { type: 'integer', description: '新的重要性 1-5。' },
      tags: { type: 'array', items: { type: 'string' }, description: '替换用的标签。' },
      pinned: { type: 'boolean', description: '置顶或取消置顶。' },
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

  register(defineTool({
    name: TOOL_DELETE,
    description:
      '按 id 永久删除一条记忆，不可撤销。'
      + '条目可能还有价值时优先 memory_archive：归档可恢复，删除不可。',
    parameters: {
      id: { type: 'string', required: true, description: '记忆 id。' },
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

  register(defineTool({
    name: TOOL_ARCHIVE,
    description:
      '归档一条记忆：从列表、检索与会话注入里消失，但仍留在库中，随时可恢复。'
      + '传 archived=false 把它恢复回来。归档不等于删除。',
    parameters: {
      id: { type: 'string', required: true, description: '记忆 id。' },
      archived: { type: 'boolean', description: 'true 归档（缺省），false 恢复。' },
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

  register(defineTool({
    name: TOOL_MOVE,
    description:
      '在 global 与 project 两个作用域之间移动一条记忆。'
      + '记错层级时用它：本该只属于某个项目的习惯落进了 global，'
      + '或本该广泛的偏好落进了某一个项目。',
    parameters: {
      id: { type: 'string', required: true, description: '记忆 id。' },
      scope: { type: 'string', required: true, enum: ['global', 'project'], description: '目标作用域。' },
      project_path: { type: 'string', description: 'scope=project 时的目标工作区目录，缺省用会话 cwd。' },
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

  register(defineTool({
    name: TOOL_ENTITY,
    description:
      '管理实体：记忆图里可复用的名词（project / tool / person / org / concept）。'
      + 'action=upsert 按名字创建或合并 —— 同名或同别名的已有实体会被合并，不会重复。'
      + 'action=list 按关键词列出实体；action=remove 删除一个实体，连同它的全部边。'
      + '实体名出现在记忆标题或标签里会连一条 about 边；只出现在正文里连 mentions 边。'
      + '共享同一实体的记忆会自动按 related 互连，不需要手工连。',
    parameters: {
      action: { type: 'string', required: true, enum: ['upsert', 'list', 'remove'], description: 'upsert | list | remove.' },
      id: { type: 'string', description: '实体 id（upsert：更新这一个；remove：删哪一个）。' },
      name: { type: 'string', description: '实体名（upsert 时必填）。' },
      kind: { type: 'string', enum: MEMORY_ENTITY_KINDS, description: '实体类别（缺省 concept）。' },
      aliases: { type: 'array', items: { type: 'string' }, description: '同一实体的其他写法（同样会触发连边）。' },
      summary: { type: 'string', description: '实体的一句话说明。' },
      keyword: { type: 'string', description: 'list：在名字 / 别名 / 摘要上做子串匹配。' },
      include_archived: { type: 'boolean', description: 'list：连已归档的实体一起列出。' },
      limit: { type: 'integer', description: 'list：最多几行（缺省 50）。' },
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

  register(defineTool({
    name: TOOL_LINK,
    description:
      '关系本身有信息量时，在记忆图里把两个节点连起来 —— 自动推导出的边只覆盖 mentions 与共现。'
      + '可用关系：' + MEMORY_EDGE_RELATIONS.join(' / ') + '。'
      + '连边是幂等的：同样的起点终点与关系复用一条边，重连只会更新 note。'
      + 'action=list 配 memory_id 看某条记忆连到了哪些节点（含自动生成的边）；action=unlink 配 edge_id 断开一条。',
    parameters: {
      action: { type: 'string', required: true, enum: ['link', 'unlink', 'list'], description: 'link | unlink | list.' },
      from: { type: 'string', description: 'link：起点记忆 id（必须已存在）。' },
      to: { type: 'string', description: 'link：终点 —— to_kind=entity 时给实体名或实体 id，否则给记忆 id。' },
      to_kind: { type: 'string', enum: ['memory', 'entity'], description: 'link：终点类型（缺省 entity）。' },
      relation: { type: 'string', enum: MEMORY_EDGE_RELATIONS, description: 'link：关系（终点是实体时缺省 about，是记忆时缺省 related）。' },
      note: { type: 'string', description: 'link：这两者为什么相关。' },
      edge_id: { type: 'string', description: 'unlink：action=list 返回的边 id。' },
      memory_id: { type: 'string', description: 'list：看这条记忆以及它连到的全部节点。' },
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

  options.onConflicts?.(conflicts)
}
