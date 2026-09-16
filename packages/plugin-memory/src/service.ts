/**
 * MemoryService —— ctx.memory：记忆库的读写核心（全局 / 项目双作用域）。
 *
 * 职责：
 * - CRUD：list / save / update / remove / setArchived / reset；
 * - 作用域路由：scope=project 的记忆必须带工作区目录，写入前归一化比较；
 * - 去重合并：同作用域 + 同分类 + 同标题（归一化）就地更新，绝不产生重复条目；
 * - 导入/导出：解析「个人画像」提示词的输出，也能反向导出成同样的 Markdown；
 * - 自动注入候选：按会话 cwd 取「全局 + 当前项目」的高重要性条目。
 *
 * 读取同步（storage-domain 权威内存态）；写入经后端持久化后生效。
 * 同时是 Typert Gateway 的 Remote 服务（SRC 标记模式，无 codegen）。
 */

import { randomUUID } from 'node:crypto'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { memoryDomain } from './domain.ts'
import { MEMORY_KINDS, MEMORY_KIND_LABELS, MEMORY_SYMMETRIC_RELATIONS } from './types.ts'
import type { MemorySettingsAccess } from './settings.ts'
import type {
  MemoryAuditEntry, MemoryAuditInput, MemoryAuditQuery, MemoryConfig, MemoryEdge,
  MemoryEdgeQuery, MemoryEdgeRelation, MemoryEntity, MemoryEntityId, MemoryEntityInput,
  MemoryEntityQuery, MemoryGraphNode, MemoryId, MemoryImportInput,
  MemoryImportResult, MemoryIngestInput, MemoryIngestResult, MemoryKind, MemoryLinkInput, MemoryNeighborhood,
  MemoryPatch, MemoryConflict, MemoryNodeRef,
  MemoryProjectSummary, MemoryQuery, MemoryRawDocument, MemoryRawId, MemoryRawInput, MemoryRawQuery,
  MemoryRecord, MemorySaveInput, MemoryScope, MemoryStats,
} from './types.ts'

/** 原文留档保留上限（超出按最旧清理）：转录很长，不能无限堆在 KV 里。 */
export const MEMORY_RAW_LIMIT = 200
/** 审计保留上限。 */
export const MEMORY_AUDIT_LIMIT = 500
/** 单条记忆的正文上限（字符）。超限拒绝写入，逼源头写短，而不是静默截断。 */
export const MEMORY_CONTENT_LIMIT = 320
/** 摄取条目的默认重要性（用户主动整理过的内容，高于自动提炼的 3）。 */
export const IMPORT_IMPORTANCE = 4
/** 语义重叠合并阈值：正文 Dice 达到即视为同一条。 */
export const MEMORY_OVERLAP_CONTENT = 0.8
/** 语义重叠合并阈值：标题 Dice 达到即视为同一条。 */
export const MEMORY_OVERLAP_TITLE = 0.9
/** 行首的列表 / 编号 / markdown 标题标记（service 的单段校验与 capture 过滤共用）。 */
export const MEMORY_LINE_MARKER_PATTERN = /^\s*(?:[-*+•]\s|\d+[.)]\s|#{1,6}\s)/

function amountOf(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.round(value))
}

/** 路径归一化键（去尾分隔符 + 统一斜杠 + 小写）：项目记忆的归属比较以此为准。 */
export function normalizeProjectKey(path: string): string {
  return path.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
}

/** 目录末段（项目显示名）；空串与根路径按原样返回。 */
export function projectLabelOf(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

function clampImportance(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 3
  return Math.min(5, Math.max(1, Math.round(value)))
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return []
  const out: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (trimmed !== '' && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/** 超限就抛可读错误；调用方（工具 / 面板 / 摄取）自己决定怎么处理。 */
function assertContentWithinLimit(text: string): void {
  if (text.length <= MEMORY_CONTENT_LIMIT) return
  throw new Error(
    '记忆内容超出上限：当前 ' + text.length + ' 字，上限 ' + MEMORY_CONTENT_LIMIT
    + ' 字。请精简后再写入（同标题合并后的总长也受此限制）。',
  )
}

/**
 * 单段纯文本校验：正文含换行、或以列表 / 编号 / markdown 标题标记开头，一律拒写。
 * 记忆正文是「结论一句话」，允许换行就等于允许把排查过程整段贴进来。
 * 只对非 import 来源生效（导入解析出来的是行式文本，不受这条约束）。
 */
function assertSingleParagraph(text: string): void {
  const breaks = text.match(/\r\n|\r|\n/g)?.length ?? 0
  if (breaks > 0) {
    throw new Error(
      '记忆正文必须是单段纯文本：当前含 ' + breaks + ' 处换行（上限 ' + MEMORY_CONTENT_LIMIT
      + ' 字，请勿用换行/列表排版）',
    )
  }
  const marker = MEMORY_LINE_MARKER_PATTERN.exec(text)
  if (marker !== null) {
    throw new Error(
      '记忆正文必须是单段纯文本：检测到列表/编号/markdown 标题标记「' + marker[0].trim()
      + '」（上限 ' + MEMORY_CONTENT_LIMIT + ' 字，请勿用换行/列表排版）',
    )
  }
}

/** 折叠成单段：去首尾空白，行内换行折算成空格。 */
function flattenToParagraph(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

/**
 * 同一条目的重复写入：新内容已包含在旧内容里就保留旧的，否则接在同一段里。
 *
 * 正文只允许单段纯文本，所以两边都先把换行折算成空格再合并 —— 合并结果仍是一段，
 * 能过 assertSingleParagraph（历史库里可能存着多段的旧条目，一经合并即归一成单段）。
 */
export function mergeContent(previous: string, incoming: string): string {
  const oldText = flattenToParagraph(previous)
  const newText = flattenToParagraph(incoming)
  if (newText === '') return oldText
  if (oldText === '') return newText
  if (oldText.includes(newText)) return oldText
  if (newText.includes(oldText)) return newText
  return oldText + ' ' + newText
}

/** 记忆文本归一化：小写、只留字母数字与汉字（语义重叠比较的输入）。 */
export function normalizeMemoryText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

/**
 * bigram Dice 相似度（0-1，1 = 完全相同）。二元组按出现次数取交集；
 * 归一化后不足两个字符（单字）时退化为相等判断 —— 没有二元组可比，不硬凑。
 */
export function bigramDice(a: string, b: string): number {
  if (a === b) return 1
  if (a === '' || b === '') return 0
  const gramCounts = (text: string): Map<string, number> => {
    const out = new Map<string, number>()
    for (let index = 0; index + 1 < text.length; index += 1) {
      const gram = text.slice(index, index + 2)
      out.set(gram, (out.get(gram) ?? 0) + 1)
    }
    return out
  }
  const left = gramCounts(a)
  const right = gramCounts(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const [gram, count] of left) {
    const other = right.get(gram)
    if (other !== undefined) shared += Math.min(count, other)
  }
  let total = 0
  for (const count of left.values()) total += count
  for (const count of right.values()) total += count
  return total === 0 ? 0 : (2 * shared) / total
}

/** 自动提及匹配的最小名称长度：单字（「我」「它」）命中率太脏，不做实体的候选。 */
export const MEMORY_ENTITY_MIN_CHARS = 2

/** 实体名归一化：去首尾空白 + 折叠内部空白。 */
export function normalizeEntityName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** 实体名 / 标题 / 别名的比较键：归一化后大小写不敏感。 */
export function entityNameKey(name: string): string {
  return normalizeEntityName(name).toLowerCase()
}

/** 端点序列化键：'memory:<id>' / 'entity:<id>'（边的存储与索引都以此为准）。 */
export function nodeKey(ref: MemoryNodeRef): string {
  return ref.kind + ':' + ref.id
}

/** 端点键解析；格式非法返回 undefined（不抛错，坏数据当噪声丢掉）。 */
export function parseNodeKey(key: string): MemoryNodeRef | undefined {
  const index = key.indexOf(':')
  if (index <= 0) return undefined
  const kind = key.slice(0, index)
  if (kind !== 'memory' && kind !== 'entity') return undefined
  return { kind, id: key.slice(index + 1) }
}

/** 端点键排序（对称边归一化端点顺序用）。 */
function compareNodeKey(a: MemoryNodeRef, b: MemoryNodeRef): number {
  const left = nodeKey(a)
  const right = nodeKey(b)
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * 边的确定性 id：同「端点 + 关系」永远同一个 id，因此重复连 = 更新那一条。
 * 对称关系（related / contradicts / same-as）先把两个端点排序，a→b 与 b→a 归一成同一条。
 */
export function edgeIdOf(from: MemoryNodeRef, to: MemoryNodeRef, relation: MemoryEdgeRelation): string {
  const symmetric = MEMORY_SYMMETRIC_RELATIONS.includes(relation)
  const [left, right] = symmetric && compareNodeKey(from, to) > 0 ? [to, from] : [from, to]
  return nodeKey(left) + '|' + relation + '|' + nodeKey(right)
}

/** 建边时的默认关系：记忆 → 实体 = about（主题就是它），其余 related。 */
export function defaultEdgeRelation(from: MemoryNodeRef, to: MemoryNodeRef): MemoryEdgeRelation {
  return from.kind === 'memory' && to.kind === 'entity' ? 'about' : 'related'
}

/** 边排序：关系 → 权重降序 → 最近更新。 */
export function compareEdges(a: MemoryEdge, b: MemoryEdge): number {
  if (a.relation !== b.relation) return a.relation < b.relation ? -1 : 1
  if (a.weight !== b.weight) return b.weight - a.weight
  return b.updatedAt - a.updatedAt
}

/** 实体排序：名称（中文按拼音），已归档排最后。 */
export function compareEntities(a: MemoryEntity, b: MemoryEntity): number {
  if (a.archived !== b.archived) return a.archived ? 1 : -1
  return a.name.localeCompare(b.name, 'zh-Hans-CN')
}

/**
 * 别名并集：把「并入的标题」与显式别名合并成别名表，并剔掉与本体标题相同的写法
 * （别名只承载「同一条的别的说法」，自己不该是自己的别名）。
 */
export function mergeAliases(
  record: { title: string; aliases: readonly string[] },
  title: string | undefined,
  extra: readonly string[] | undefined,
): string[] {
  const own = entityNameKey(record.title)
  const candidates = [...record.aliases, ...(title !== undefined ? [title] : []), ...(extra ?? [])]
  return normalizeTags(candidates).filter((alias) => entityNameKey(alias) !== own)
}

/** 参与重叠比较的最小形状：已有条目与待写入内容都满足。 */
export interface MemoryOverlapText {
  readonly title: string
  readonly content: string
}

/** 标题 / 正文各自的语义重叠分（归一化后算 bigram Dice）。 */
export function overlapScores(
  existing: MemoryOverlapText,
  incoming: MemoryOverlapText,
): { titleScore: number; contentScore: number } {
  return {
    titleScore: bigramDice(normalizeMemoryText(existing.title), normalizeMemoryText(incoming.title)),
    contentScore: bigramDice(normalizeMemoryText(existing.content), normalizeMemoryText(incoming.content)),
  }
}

/** 排序：置顶 → 重要性 → 最近更新。 */
export function compareMemories(a: MemoryRecord, b: MemoryRecord): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.importance !== b.importance) return b.importance - a.importance
  return b.updatedAt - a.updatedAt
}

/** 解析出来的一条导入项。 */
export interface ParsedMemoryItem {
  readonly title: string
  readonly content: string
  readonly kind: MemoryKind
}

/** 画像小节标题 → 记忆分类。 */
const SECTION_KINDS: Record<string, MemoryKind> = {
  指令: 'preference',
  偏好: 'preference',
  身份: 'user',
  职业: 'user',
  项目: 'project',
  决策: 'decision',
  事实: 'fact',
  经历: 'history',
  历史: 'history',
}

function headingOf(line: string): string | undefined {
  const trimmed = line.trim()
  const md = /^#{1,6}\s*(.+?)\s*$/.exec(trimmed)
  if (md) return md[1]?.replace(/[：:]$/, '') ?? undefined
  const bold = /^\*\*(.+?)\*\*\s*[：:]?\s*$/.exec(trimmed)
  if (bold) return bold[1]?.replace(/[：:]$/, '') ?? undefined
  // 「指令：」这种独立小节标题（无正文）也算。
  const plain = /^([\u4e00-\u9fa5A-Za-z]{2,6})[：:]$/.exec(trimmed)
  if (plain) return plain[1] ?? undefined
  return undefined
}

function kindOfHeading(heading: string): MemoryKind | undefined {
  return SECTION_KINDS[heading.trim()]
}

/** 去掉条目开头的 [日期] / [unknown] 前缀（含紧随的破折号）。 */
function stripDatePrefix(text: string): string {
  const matched = /^\[([^\]]+)\]\s*(?:[-—–]\s*)?(.*)$/.exec(text)
  if (matched !== null && matched[2] !== undefined && matched[2].trim() !== '') return matched[2].trim()
  return text
}

function titleOf(content: string): string {
  const firstLine = content.split('\n')[0]?.trim() ?? content
  const clean = firstLine.replace(/[。．.；;，,]+$/, '')
  return clean.length > 40 ? clean.slice(0, 40) : clean
}

/**
 * 解析导入文本：既吃「导入提示词」产出的画像（分类标题 + \`[日期] - 内容\` 行），
 * 也吃任意纯文本（每个非空行一条「事实」）。代码块围栏与注释行被忽略。
 * 纯函数，便于单测。
 */
export function parseImportedText(text: string): ParsedMemoryItem[] {
  const items: ParsedMemoryItem[] = []
  let current: MemoryKind = 'fact'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('```') || line.startsWith('<!--')) continue
    // 列表项：可带 [日期] / [unknown] 前缀。
    const bullet = /^[-*+]\s+(.+)$/.exec(line) ?? /^\[([^\]]+)\]\s*[-—–]\s*(.+)$/.exec(line)
    if (bullet) {
      const content = bullet.length === 3 ? (bullet[2] ?? '') : (bullet[1] ?? '')
      const trimmed = stripDatePrefix(content.trim())
      if (trimmed === '') continue
      items.push({ title: titleOf(trimmed), content: trimmed, kind: current })
      continue
    }
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (numbered) {
      const trimmed = stripDatePrefix((numbered[1] ?? '').trim())
      if (trimmed === '') continue
      items.push({ title: titleOf(trimmed), content: trimmed, kind: current })
      continue
    }
    const heading = headingOf(line)
    if (heading !== undefined) {
      const mapped = kindOfHeading(heading)
      if (mapped !== undefined) current = mapped
      // 认不出分类的标题一律当章节标题跳过（典型的如文档大标题「# 个人使用画像」）。
      // 以前它会掉到下面按裸行收成一条记忆，于是每次导入都多出一条名为文档标题的记录。
      continue
    }
    // 裸行：当作当前分类下的一条记录。
    items.push({ title: titleOf(line), content: line, kind: current })
  }
  return items
}

/** 同一份原文里标题重复的条目先自行去重（保留先出现的那个）。纯函数。 */
export function dedupeParsedItems(items: readonly ParsedMemoryItem[]): { items: ParsedMemoryItem[]; skipped: number } {
  const seen = new Set<string>()
  const out: ParsedMemoryItem[] = []
  let skipped = 0
  for (const item of items) {
    const key = normalizeProjectKey(item.title)
    if (key === '' || seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    out.push(item)
  }
  return { items: out, skipped }
}

/** 留档标题：原文首个像正文的行（去掉标题/列表/日期前缀），截 40 字。纯函数。 */
export function rawTitleOf(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
      .replace(/^(?:#{1,6}|[-*+]|\d+[.)])\s*/, '')
      .replace(/^\[[^\]]*\]\s*[-—–]?\s*/, '')
      .trim()
    if (trimmed === '') continue
    return trimmed.length > 40 ? trimmed.slice(0, 40) : trimmed
  }
  return '（空原文）'
}

/** 留档的「新鲜度」：写过就用写入时间，否则用创建时间。 */
export function rawFreshness(doc: MemoryRawDocument): number {
  return doc.updatedAt > 0 ? doc.updatedAt : doc.createdAt
}

/** 留档排序：最新在前。 */
export function compareRawDocuments(a: MemoryRawDocument, b: MemoryRawDocument): number {
  return rawFreshness(b) - rawFreshness(a)
}

/** 超出上限时该删掉的留档 id（最旧的先删）。纯函数，便于单测。 */
export function prunableRawIds(docs: readonly MemoryRawDocument[], limit: number): MemoryRawId[] {
  if (limit <= 0) return docs.map((doc) => doc.id)
  if (docs.length <= limit) return []
  return [...docs].sort(compareRawDocuments).slice(limit).map((doc) => doc.id)
}

/** 合并落点：'title' 同标题就地更新 / 'overlap' 语义重叠并入。 */
export type MemoryMergeReason = 'title' | 'overlap'

/** saveWithOutcome 的结果：记录本身 + 这次是新建还是并进了哪一条。 */
export interface MemorySaveOutcome {
  readonly record: MemoryRecord
  readonly created: boolean
  readonly mergedBy?: MemoryMergeReason
}

export interface MemoryServiceConfig {
  /** memory 存储域。 */
  readonly domain: Domain<typeof memoryDomain>
  /** 已知工作区目录（来自 ctx.workspaceRegistry）；面板项目下拉的候选。 */
  readonly knownWorkspaces?: () => Promise<readonly string[]>
  /** 设置句柄：面板开关（生成对话记忆 / 自动注入）读写同一命名空间。 */
  readonly settings?: MemorySettingsAccess
}

export class MemoryService extends TypertRemoteService {
  private readonly memories: KvTable<MemoryId, MemoryRecord>
  private readonly rawDocs: KvTable<MemoryRawId, MemoryRawDocument>
  private readonly auditRows: KvTable<string, MemoryAuditEntry>
  /** wiki 图层：实体表与边表（边是关联的唯一真相来源，记忆/实体两侧都不冗余存邻居）。 */
  private readonly entities: KvTable<MemoryEntityId, MemoryEntity>
  private readonly edges: KvTable<string, MemoryEdge>
  private readonly config: MemoryServiceConfig

  /** 与其它记忆插件的重名冲突（tools 桥探测后回填；空表示无冲突）。 */
  private conflicts: MemoryConflict[] = []

  constructor(ctx: Context, config: MemoryServiceConfig) {
    super(ctx, 'memory')
    this.config = config
    this.memories = config.domain.table('memories')
    this.rawDocs = config.domain.table('raw_documents')
    this.auditRows = config.domain.table('audits')
    this.entities = config.domain.table('entities')
    this.edges = config.domain.table('edges')
  }

  /* ---------------- 内部工具 ---------------- */

  private collect(): MemoryRecord[] {
    return Array.from(this.memories.entries(), ([, record]) => record)
  }

  private collectRaw(): MemoryRawDocument[] {
    return Array.from(this.rawDocs.entries(), ([, doc]) => doc)
  }

  private collectAudits(): MemoryAuditEntry[] {
    return Array.from(this.auditRows.entries(), ([, entry]) => entry)
  }

  private collectEntities(): MemoryEntity[] {
    return Array.from(this.entities.entries(), ([, entity]) => entity)
  }

  private collectEdges(): MemoryEdge[] {
    return Array.from(this.edges.entries(), ([, edge]) => edge)
  }

  /** 把解析出来的条目写进记忆库（同作用域 + 同分类 + 同标题就地合并）。 */
  private async applyItems(
    items: readonly ParsedMemoryItem[],
    target: { scope: MemoryScope; projectPath: string; source: string; importance: number },
  ): Promise<{ added: number; merged: number; skipped: number; recordIds: string[] }> {
    let added = 0
    let merged = 0
    let skipped = 0
    const recordIds: string[] = []
    for (const item of items) {
      const existing = this.findByTitle(item.title, target.scope, target.projectPath, item.kind)
      let saved: MemoryRecord
      try {
        saved = await this.save({
          title: item.title,
          content: item.content,
          kind: item.kind,
          scope: target.scope,
          ...(target.projectPath !== '' ? { projectPath: target.projectPath } : {}),
          importance: target.importance,
          source: target.source,
        })
      } catch {
        // 单条不合格（超长、缺字段）只跳过这一条，不让整批导入失败。
        skipped += 1
        continue
      }
      recordIds.push(saved.id)
      if (existing === undefined) added += 1
      else merged += 1
    }
    return { added, merged, skipped, recordIds }
  }

  private findByTitle(title: string, scope: MemoryScope, projectPath: string, kind: MemoryKind): MemoryRecord | undefined {
    const key = normalizeProjectKey(title)
    const pathKey = normalizeProjectKey(projectPath)
    return this.collect().find((record) =>
      record.kind === kind
      && record.scope === scope
      && normalizeProjectKey(record.projectPath) === pathKey
      && (normalizeProjectKey(record.title) === key
        // wiki 的 redirect：命中别名 = 同一条（换了说法的标题不该另起一条）。
        || record.aliases.some((alias) => normalizeProjectKey(alias) === key)))
  }

  /* ---------------- 读 ---------------- */

  /** 列出记忆（默认不含已归档）。 */
  // 注意：这是 Typert SRC 标记的远程方法，参数必须是纯标识符 ——
  // 不能有默认值 / 解构 / rest，否则 gateway 会在挂载时报
  // 'SRC method "list" must use unique identifier parameters ...'。
  // 需要「不传即全量」的语义时，由调用方显式传 {}。
  async list(query: MemoryQuery): Promise<MemoryRecord[]> {
    const keyword = query.keyword?.trim().toLowerCase()
    const pathKey = query.projectPath !== undefined ? normalizeProjectKey(query.projectPath) : undefined
    const out = this.collect().filter((record) => {
      if (query.includeArchived !== true && record.archived) return false
      if (query.scope !== undefined && record.scope !== query.scope) return false
      if (query.kind !== undefined && record.kind !== query.kind) return false
      if (pathKey !== undefined) {
        if (record.scope !== 'project') return false
        if (normalizeProjectKey(record.projectPath) !== pathKey) return false
      }
      if (keyword !== undefined && keyword !== '') {
        const hay = (record.title + '\n' + record.summary + '\n' + record.content
          + '\n' + record.aliases.join(' ') + '\n' + record.tags.join(' ')).toLowerCase()
        if (!hay.includes(keyword)) return false
      }
      return true
    })
    out.sort(compareMemories)
    return query.limit !== undefined && query.limit > 0 ? out.slice(0, query.limit) : out
  }

  /* ---------------- 设置 ---------------- */

  /** 读面板开关（生成对话记忆 / 自动注入 / 注入条数与门槛）。 */
  async getConfig(): Promise<MemoryConfig> {
    if (this.config.settings !== undefined) return this.config.settings.get()
    // settings 未就绪时的兜底：字段与默认值必须和 MEMORY_CONFIG_BASE 保持一致。
    return {
      autoCapture: true,
      autoInject: true,
      maxInjected: 6,
      importanceThreshold: 4,
      captureEveryTurns: 3,
      captureMaxTurns: 4,
      captureMaxChars: 4000,
      captureIncludeAssistant: false,
    }
  }

  /** 写面板开关；settings 未就绪或被锁时抛可读错误。 */
  async setConfig(patch: Partial<MemoryConfig>): Promise<MemoryConfig> {
    if (this.isLocked()) {
      throw new Error('检测到另一个记忆插件占用了 memory_* 工具名，本插件已被锁定，无法开启。请先在「插件」里停用另一个记忆插件，再重启 dsh。')
    }
    if (this.config.settings === undefined) throw new Error('配置服务尚未就绪，请稍后再试')
    await this.config.settings.update(patch)
    return this.config.settings.get()
  }

  /* ---------------- 冲突 ---------------- */

  /** 回填 tools 桥探测到的重名冲突（host 内部调用，非远程方法）。 */
  setConflicts(conflicts: readonly MemoryConflict[]): void {
    this.conflicts = [...conflicts]
  }

  /** 读冲突列表（面板据此提示「已有另一个记忆插件」）。 */
  async getConflicts(): Promise<MemoryConflict[]> {
    return [...this.conflicts]
  }

  /**
   * 是否被硬锁。检测到别的记忆插件占用 memory_* 时就锁死本插件：
   * 不注册工具、不注入、不提炼，面板里的开关也点不动。
   * 「两个记忆插件同时跑」是不受支持的组合，不做部分可用那种半吊子状态。
   */
  isLocked(): boolean {
    return this.conflicts.length > 0
  }

  /** 记忆库概览。 */
  async stats(): Promise<MemoryStats> {
    const all = this.collect()
    const live = all.filter((record) => !record.archived)
    const byPath = new Map<string, { path: string; count: number }>()
    for (const record of live) {
      if (record.scope !== 'project') continue
      const path = record.projectPath.trim()
      if (path === '') continue
      const key = normalizeProjectKey(path)
      const entry = byPath.get(key)
      if (entry === undefined) byPath.set(key, { path, count: 1 })
      else byPath.set(key, { path: entry.path, count: entry.count + 1 })
    }
    const projects: MemoryProjectSummary[] = [...byPath.values()]
      .map((entry) => ({ path: entry.path, label: projectLabelOf(entry.path), count: entry.count }))
      .sort((a, b) => b.count - a.count)
    return {
      total: live.length,
      archived: all.length - live.length,
      global: live.filter((record) => record.scope === 'global').length,
      project: live.filter((record) => record.scope === 'project').length,
      projects,
      raw: this.collectRaw().length,
      audits: this.collectAudits().length,
      entities: this.collectEntities().filter((entity) => !entity.archived).length,
      edges: this.collectEdges().length,
    }
  }

  /** 项目记忆维度列表（已存项目 + 已知工作区候选合并去重）。 */
  async projects(): Promise<MemoryProjectSummary[]> {
    const stats = await this.stats()
    const known = this.config.knownWorkspaces === undefined ? [] : await this.config.knownWorkspaces()
    const merged = new Map<string, MemoryProjectSummary>()
    for (const item of stats.projects) merged.set(normalizeProjectKey(item.path), item)
    for (const path of known) {
      const key = normalizeProjectKey(path)
      if (key === '' || merged.has(key)) continue
      merged.set(key, { path, label: projectLabelOf(path), count: 0 })
    }
    return [...merged.values()].sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      return a.label.localeCompare(b.label)
    })
  }

  /** 导出成 Markdown（与导入提示词的格式同构，便于复制到别的 AI 工具）。 */
  async exportText(scope: MemoryScope, projectPath?: string): Promise<string> {
    const records = await this.list({ scope, ...(projectPath !== undefined ? { projectPath } : {}) })
    const title = scope === 'global' ? '# 全局记忆' : '# 项目记忆：' + (projectPath ?? '')
    const lines = [title, '']
    for (const kind of MEMORY_KINDS) {
      const group = records.filter((record) => record.kind === kind)
      if (group.length === 0) continue
      lines.push('## ' + MEMORY_KIND_LABELS[kind], '')
      for (const record of group) {
        const date = new Date(record.updatedAt).toISOString().slice(0, 10)
        lines.push('- [' + date + '] ' + record.content.replace(/\n/g, ' '))
      }
      lines.push('')
    }
    if (records.length === 0) lines.push('（暂无记忆）', '')
    return lines.join('\n').trimEnd()
  }

  /** 自动注入候选：全局 + 当前会话 cwd 对应的项目记忆，按重要性与置顶排序。 */
  injectCandidates(sessionCwd: string | undefined, options: { maxItems: number; threshold: number }): MemoryRecord[] {
    // 被锁 = 本插件让位：一条都不注入，避免和另一个记忆插件重复喂上下文。
    if (this.isLocked()) return []
    const cwdKey = sessionCwd === undefined ? undefined : normalizeProjectKey(sessionCwd)
    const live = this.collect().filter((record) => !record.archived)
    const scoped = live.filter((record) => {
      if (record.scope === 'global') return true
      if (cwdKey === undefined) return false
      return normalizeProjectKey(record.projectPath) === cwdKey
    })
    const eligible = scoped.filter((record) => record.pinned || record.importance >= options.threshold)
    eligible.sort(compareMemories)
    return eligible.slice(0, Math.max(1, options.maxItems))
  }

  /**
   * 已有记忆的标题清单，喂给自动提炼当「别另起新标题」的参考：
   * scope=global 或（scope=project 且 projectPath === 会话 cwd），按 updatedAt 倒序、去重。
   * 同步方法（只读内存态），调用方拿不到也照常提炼。
   */
  overlapTitleHints(sessionCwd: string | undefined, limit = 30): string[] {
    if (limit <= 0) return []
    const cwdKey = sessionCwd === undefined ? undefined : normalizeProjectKey(sessionCwd)
    const scoped = this.collect().filter((record) => {
      if (record.scope === 'global') return true
      if (cwdKey === undefined) return false
      return normalizeProjectKey(record.projectPath) === cwdKey
    })
    scoped.sort((a, b) => b.updatedAt - a.updatedAt)
    const seen = new Set<string>()
    const out: string[] = []
    for (const record of scoped) {
      const title = record.title.trim()
      if (title === '') continue
      const key = normalizeProjectKey(title)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(title)
      if (out.length >= limit) break
    }
    return out
  }

  /* ---------------- 摄取管线（原文留档 → 抽取 → 条目） ---------------- */

  /**
   * 摄取一份原文：先留档（永不丢），再解析成条目，最后回填抽取痕迹。
   * mode=replace 时先清空目标作用域（连带该作用域的旧留档），再走后半段。
   */
  async ingest(input: MemoryIngestInput): Promise<MemoryIngestResult> {
    const scope: MemoryScope = input.scope ?? 'global'
    const projectPath = scope === 'project' ? (input.projectPath ?? '').trim() : ''
    if (scope === 'project' && projectPath === '') {
      throw new Error('ingesting into project memory requires a project path')
    }
    const origin = input.origin ?? 'import'
    let removed = 0
    if (input.mode === 'replace') {
      removed = await this.reset(scope, projectPath === '' ? undefined : projectPath)
    }
    const raw = await this.storeRawDocument({
      text: input.text,
      origin,
      scope,
      ...(projectPath !== '' ? { projectPath } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    })
    const parsed = dedupeParsedItems(parseImportedText(input.text))
    const applied = await this.applyItems(parsed.items, {
      scope, projectPath, source: origin, importance: IMPORT_IMPORTANCE,
    })
    await this.markExtracted(raw.id, applied.recordIds)
    await this.pruneRawDocuments(MEMORY_RAW_LIMIT)
    return {
      added: applied.added,
      merged: applied.merged,
      skipped: parsed.skipped + applied.skipped,
      removed,
      rawId: raw.id,
      origin,
      recordIds: applied.recordIds,
    }
  }

  /**
   * 对已留档的原文重跑抽取（换了算法、或上次抽取失败时用）。
   * 不新建留档，抽取痕迹回填到同一份原文上。
   */
  async reingest(rawId: MemoryRawId): Promise<MemoryIngestResult> {
    const doc = await this.rawDocs.get(rawId)
    if (doc === undefined) throw new Error('unknown raw document')
    const parsed = dedupeParsedItems(parseImportedText(doc.text))
    const applied = await this.applyItems(parsed.items, {
      scope: doc.scope, projectPath: doc.projectPath, source: doc.origin, importance: IMPORT_IMPORTANCE,
    })
    await this.markExtracted(rawId, applied.recordIds)
    return {
      added: applied.added,
      merged: applied.merged,
      skipped: parsed.skipped + applied.skipped,
      removed: 0,
      rawId,
      origin: doc.origin,
      recordIds: applied.recordIds,
    }
  }

  /** 落一份原文留档（不解析）。ingest 与 capture 共用这一段。 */
  async storeRawDocument(input: MemoryRawInput): Promise<MemoryRawDocument> {
    if (input.text.trim() === '') throw new Error('raw document text must not be empty')
    const scope = input.scope
    const projectPath = scope === 'project' ? (input.projectPath ?? '').trim() : ''
    if (scope === 'project' && projectPath === '') {
      throw new Error('project-scoped raw document requires a project path (workspace directory)')
    }
    const now = Date.now()
    const title = (input.title ?? rawTitleOf(input.text)).trim()
    // 会话转录按会话归并：一个会话一份，后一轮覆盖前一轮（转录本身是累积的，
    // 越后越全）。否则每轮都存一份高度重叠的全文，很快把留档区冲垮。
    if (input.origin === 'capture' && input.sessionId !== undefined) {
      const existing = this.collectRaw().find((doc) =>
        doc.origin === 'capture' && doc.sessionId === input.sessionId)
      if (existing !== undefined) {
        const merged: MemoryRawDocument = {
          ...existing,
          title,
          text: input.text,
          textLength: input.text.length,
          updatedAt: now,
          ...(input.note !== undefined ? { note: input.note } : {}),
        }
        await this.rawDocs.put(merged.id, merged)
        return merged
      }
    }
    const doc: MemoryRawDocument = {
      id: brandString<MemoryRawId>(randomUUID()),
      origin: input.origin,
      scope,
      projectPath,
      title,
      text: input.text,
      textLength: input.text.length,
      createdAt: now,
      updatedAt: now,
      recordIds: [],
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    }
    await this.rawDocs.put(doc.id, doc)
    return doc
  }

  /** 回填「这份原文抽出了哪些条目」。 */
  async markExtracted(rawId: MemoryRawId, recordIds: readonly string[]): Promise<MemoryRawDocument | undefined> {
    const current = await this.rawDocs.get(rawId)
    if (current === undefined) return undefined
    const merged = [...current.recordIds]
    for (const id of recordIds) if (!merged.includes(id)) merged.push(id)
    const next: MemoryRawDocument = { ...current, recordIds: merged, extractedAt: Date.now() }
    await this.rawDocs.put(next.id, next)
    return next
  }

  /** 列原文留档（最新在前）。 */
  async rawDocuments(query: MemoryRawQuery): Promise<MemoryRawDocument[]> {
    const pathKey = query.projectPath !== undefined ? normalizeProjectKey(query.projectPath) : undefined
    let out = this.collectRaw().filter((doc) => {
      if (query.origin !== undefined && doc.origin !== query.origin) return false
      if (query.scope !== undefined && doc.scope !== query.scope) return false
      if (pathKey !== undefined && normalizeProjectKey(doc.projectPath) !== pathKey) return false
      return true
    })
    out.sort(compareRawDocuments)
    if (query.limit !== undefined && query.limit > 0) out = out.slice(0, query.limit)
    if (query.includeText === false) out = out.map((doc) => ({ ...doc, text: '' }))
    return out
  }

  /** 取一份原文留档（含全文）。 */
  async getRawDocument(rawId: MemoryRawId): Promise<MemoryRawDocument | undefined> {
    return this.rawDocs.get(rawId)
  }

  /** 删掉一份原文留档（已抽出的条目不动）。 */
  async removeRawDocument(rawId: MemoryRawId): Promise<boolean> {
    const current = await this.rawDocs.get(rawId)
    if (current === undefined) return false
    await this.rawDocs.delete(rawId)
    return true
  }

  /** 留档超出上限时按「最新优先」清理，返回清理条数。 */
  async pruneRawDocuments(limit: number): Promise<number> {
    const ids = prunableRawIds(this.collectRaw(), limit)
    for (const id of ids) await this.rawDocs.delete(id)
    return ids.length
  }

  /* ---------------- 后台调用审计（路线图 #5） ---------------- */

  /** 记一条后台模型调用；只保留最近 MEMORY_AUDIT_LIMIT 条。 */
  async recordAudit(input: MemoryAuditInput): Promise<MemoryAuditEntry> {
    const entry: MemoryAuditEntry = {
      id: randomUUID(),
      at: Date.now(),
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      ok: input.ok,
      durationMs: amountOf(input.durationMs),
      inputChars: amountOf(input.inputChars),
      outputChars: amountOf(input.outputChars),
      recordIds: [...input.recordIds],
      ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
      ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {}),
      ...(input.rawId !== undefined ? { rawId: input.rawId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.dropped !== undefined && input.dropped.length > 0
        ? { dropped: input.dropped.map((item) => ({ title: item.title, reason: item.reason })) }
        : {}),
    }
    await this.auditRows.put(entry.id, entry)
    const extra = this.collectAudits().sort((a, b) => b.at - a.at).slice(MEMORY_AUDIT_LIMIT)
    for (const old of extra) await this.auditRows.delete(old.id)
    return entry
  }

  /** 列审计（最新在前）。 */
  async audits(query: MemoryAuditQuery): Promise<MemoryAuditEntry[]> {
    let out = this.collectAudits().filter((entry) => {
      if (query.kind !== undefined && entry.kind !== query.kind) return false
      if (query.ok !== undefined && entry.ok !== query.ok) return false
      return true
    })
    out.sort((a, b) => b.at - a.at)
    if (query.limit !== undefined && query.limit > 0) out = out.slice(0, query.limit)
    return out
  }

  /* ---------------- wiki 图层：实体 ---------------- */

  /** 按 id / 名称 / 别名找一个实体（比较大小写不敏感）。 */
  private findEntity(ref: string): MemoryEntity | undefined {
    const key = entityNameKey(ref)
    return this.collectEntities().find((entity) =>
      entity.id === ref
      || entityNameKey(entity.name) === key
      || entity.aliases.some((alias) => entityNameKey(alias) === key))
  }

  /** 列实体（默认不含已归档）。 */
  async listEntities(query: MemoryEntityQuery): Promise<MemoryEntity[]> {
    const keyword = query.keyword?.trim().toLowerCase()
    const out = this.collectEntities().filter((entity) => {
      if (query.includeArchived !== true && entity.archived) return false
      if (query.kind !== undefined && entity.kind !== query.kind) return false
      if (keyword !== undefined && keyword !== '') {
        const hay = (entity.name + '\n' + entity.aliases.join(' ') + '\n' + entity.summary).toLowerCase()
        if (!hay.includes(keyword)) return false
      }
      return true
    })
    out.sort(compareEntities)
    return query.limit !== undefined && query.limit > 0 ? out.slice(0, query.limit) : out
  }

  /**
   * 落一个实体：带 id 就地更新；不带 id 时按名称 / 别名命中原有实体则并入
   * （补别名与摘要、可补类别），否则新建一个。名称或别名会影响「谁提到了它」，
   * 因此写完重算自动边。
   */
  async upsertEntity(input: MemoryEntityInput): Promise<MemoryEntity> {
    const name = normalizeEntityName(input.name)
    if (name === '') throw new Error('entity name is required')
    const now = Date.now()
    const aliases = normalizeTags(input.aliases)
    const existing = input.id === undefined
      ? this.findEntity(name)
      : await this.entities.get(brandString<MemoryEntityId>(input.id))
    if (existing !== undefined) {
      // 只有显式带 id 才算改名：按名称 / 别名命中的写入不夺走原来的规范名，
      // 而是把这次用的写法登记成别名（wiki 的 redirect）。
      const renamed = input.id !== undefined
      const nextName = renamed ? name : existing.name
      const sameName = entityNameKey(name) === entityNameKey(existing.name)
      // 改名时把旧名落成别名；按别名写入时把这次的写法登记成别名。
      const extraAliases = sameName ? aliases : [...aliases, renamed ? existing.name : name]
      const next: MemoryEntity = {
        ...existing,
        name: nextName,
        kind: input.kind ?? existing.kind,
        aliases: mergeAliases({ title: nextName, aliases: existing.aliases }, undefined, extraAliases),
        summary: input.summary === undefined || input.summary.trim() === ''
          ? existing.summary
          : input.summary.trim(),
        archived: input.archived ?? existing.archived,
        updatedAt: now,
      }
      await this.entities.put(next.id, next)
      await this.syncAutoEdges()
      return next
    }
    const entity: MemoryEntity = {
      id: brandString<MemoryEntityId>(randomUUID()),
      name,
      kind: input.kind ?? 'concept',
      aliases: mergeAliases({ title: name, aliases: [] }, undefined, aliases),
      summary: input.summary?.trim() ?? '',
      archived: input.archived ?? false,
      createdAt: now,
      updatedAt: now,
    }
    await this.entities.put(entity.id, entity)
    await this.syncAutoEdges()
    return entity
  }

  /** 删一个实体：连同挂在它身上的所有边一起删（不留悬空边）。 */
  async removeEntity(id: MemoryEntityId): Promise<boolean> {
    const current = await this.entities.get(id)
    if (current === undefined) return false
    await this.entities.delete(id)
    for (const edge of this.collectEdges()) {
      if (edge.from.kind === 'entity' && edge.from.id === id) { await this.edges.delete(edge.id); continue }
      if (edge.to.kind === 'entity' && edge.to.id === id) await this.edges.delete(edge.id)
    }
    await this.syncAutoEdges()
    return true
  }

  /* ---------------- wiki 图层：边 ---------------- */

  /** 列边（默认全部；给了 node 就只看与它相连的，两个方向都算）。 */
  async listEdges(query: MemoryEdgeQuery): Promise<MemoryEdge[]> {
    const key = query.node === undefined ? undefined : nodeKey(query.node)
    let out = this.collectEdges().filter((edge) => {
      if (query.relation !== undefined && edge.relation !== query.relation) return false
      if (query.origin !== undefined && edge.origin !== query.origin) return false
      if (key !== undefined && nodeKey(edge.from) !== key && nodeKey(edge.to) !== key) return false
      return true
    })
    out.sort(compareEdges)
    if (query.limit !== undefined && query.limit > 0) out = out.slice(0, query.limit)
    return out
  }

  /**
   * 连一条边。幂等：同「端点 + 关系」= 同一条边，重复连只会更新备注。
   * 两个端点都必须真实存在 —— 悬空边在关联视图里只会变成噪音，宁可直接报错；
   * 对称关系（related 等）连 a→b 与 b→a 归一成同一条。
   */
  async link(input: MemoryLinkInput): Promise<MemoryEdge> {
    const relation = input.relation ?? defaultEdgeRelation(input.from, input.to)
    if (nodeKey(input.from) === nodeKey(input.to)) throw new Error('cannot link a node to itself')
    await this.assertNodeExists(input.from)
    await this.assertNodeExists(input.to)
    const id = edgeIdOf(input.from, input.to, relation)
    const symmetric = MEMORY_SYMMETRIC_RELATIONS.includes(relation)
    const [left, right] = symmetric && compareNodeKey(input.from, input.to) > 0
      ? [input.to, input.from]
      : [input.from, input.to]
    const now = Date.now()
    const existing = await this.edges.get(id)
    const note = input.note?.trim() ?? ''
    const edge: MemoryEdge = existing === undefined
      ? {
        id,
        from: { kind: left.kind, id: left.id },
        to: { kind: right.kind, id: right.id },
        relation,
        note,
        weight: 1,
        origin: input.origin ?? 'user',
        createdAt: now,
        updatedAt: now,
      }
      : {
        ...existing,
        note: note === '' ? existing.note : note,
        // 自动边被显式连过一次就升级成显式边：自动重算从此不再覆盖它。
        origin: existing.origin === 'auto' && input.origin !== undefined && input.origin !== 'auto'
          ? input.origin
          : existing.origin,
        updatedAt: now,
      }
    await this.edges.put(edge.id, edge)
    return edge
  }

  /** 断一条边；返回是否真的删掉了。 */
  async unlink(id: string): Promise<boolean> {
    const current = await this.edges.get(id)
    if (current === undefined) return false
    await this.edges.delete(id)
    return true
  }

  /** 删掉与某个端点相连的所有边：记忆/实体被删除时不留悬空边。 */
  private async removeEdgesFor(ref: MemoryNodeRef): Promise<void> {
    const key = nodeKey(ref)
    for (const edge of this.collectEdges()) {
      if (nodeKey(edge.from) !== key && nodeKey(edge.to) !== key) continue
      await this.edges.delete(edge.id)
    }
  }

  /** 一条记忆的关联视图：与它相连的边 + 每条边「另一端」解析出来的节点。 */
  async neighborhood(id: MemoryId): Promise<MemoryNeighborhood | undefined> {
    const memory = await this.memories.get(id)
    if (memory === undefined) return undefined
    const self = nodeKey({ kind: 'memory', id })
    const edges = await this.listEdges({ node: { kind: 'memory', id } })
    const related: { edgeId: string; node: MemoryGraphNode }[] = []
    for (const edge of edges) {
      const other = nodeKey(edge.from) === self ? edge.to : edge.from
      const node = await this.resolveNode(other)
      if (node !== undefined) related.push({ edgeId: edge.id, node })
    }
    return { memory, edges, related }
  }

  /** 全量重算自动边（面板「重建关联」按的就是这里）。 */
  async rebuildEdges(): Promise<{ added: number; removed: number }> {
    return this.syncAutoEdges()
  }

  /** 把一个端点解析成图节点；端点已被删除时返回 undefined。 */
  private async resolveNode(ref: MemoryNodeRef): Promise<MemoryGraphNode | undefined> {
    if (ref.kind === 'memory') {
      const record = await this.memories.get(brandString<MemoryId>(ref.id))
      if (record === undefined) return undefined
      return {
        ref: { kind: 'memory', id: record.id },
        label: record.title,
        kind: record.kind,
        archived: record.archived,
      }
    }
    const entity = await this.entities.get(brandString<MemoryEntityId>(ref.id))
    if (entity === undefined) return undefined
    return {
      ref: { kind: 'entity', id: entity.id },
      label: entity.name,
      kind: entity.kind,
      archived: entity.archived,
    }
  }

  private async assertNodeExists(ref: MemoryNodeRef): Promise<void> {
    if (ref.kind === 'memory') {
      if (await this.memories.get(brandString<MemoryId>(ref.id)) === undefined) {
        throw new Error('memory not found: ' + ref.id)
      }
      return
    }
    if (await this.entities.get(brandString<MemoryEntityId>(ref.id)) === undefined) {
      throw new Error('entity not found: ' + ref.id)
    }
  }

  /* ---------------- 自动边推导：提及 + 共现 ---------------- */

  /**
   * 一条记忆提到了哪些实体：实体名 / 别名出现在标题、标签、摘要或正文里即算提及
   * （名称至少 2 个字，单字命中太脏）。出现在标题或标签里算「强命中」→ about 边，
   * 只出现在摘要 / 正文里 → mentions 边。
   */
  private mentionedEntities(record: MemoryRecord): { entity: MemoryEntity; strong: boolean }[] {
    const title = record.title.toLowerCase()
    const summary = record.summary.toLowerCase()
    const content = record.content.toLowerCase()
    const tags = record.tags.join(' ').toLowerCase()
    const hay = [title, summary, content, tags]
    const strongHay = [title, tags]
    const out: { entity: MemoryEntity; strong: boolean }[] = []
    for (const entity of this.collectEntities()) {
      if (entity.archived) continue
      const names = [entity.name, ...entity.aliases]
        .map((name) => normalizeEntityName(name).toLowerCase())
        .filter((name) => name.length >= MEMORY_ENTITY_MIN_CHARS)
      if (names.length === 0) continue
      let hit = false
      let strong = false
      for (const needle of names) {
        if (strongHay.some((text) => text.includes(needle))) { hit = true; strong = true; continue }
        if (hay.some((text) => text.includes(needle))) hit = true
      }
      if (hit) out.push({ entity, strong })
    }
    return out
  }

  /**
   * 重算全部自动边（提及边 + 共现 related 边）。确定性算法，可随时重跑：
   * 先算出「这次应该是哪些自动边」，再与库里已有的自动边求差集，只写变化的那几条。
   * 手工 / 模型连过的同一条边不会被自动结果覆盖，也不会被自动清理（显式意图优先）。
   */
  private async syncAutoEdges(): Promise<{ added: number; removed: number }> {
    const desired = new Map<string, { from: MemoryNodeRef; to: MemoryNodeRef; relation: MemoryEdgeRelation; weight: number }>()
    const byEntity = new Map<string, string[]>()
    for (const record of this.collect()) {
      if (record.archived) continue
      for (const { entity, strong } of this.mentionedEntities(record)) {
        const from: MemoryNodeRef = { kind: 'memory', id: record.id }
        const to: MemoryNodeRef = { kind: 'entity', id: entity.id }
        const relation: MemoryEdgeRelation = strong ? 'about' : 'mentions'
        desired.set(edgeIdOf(from, to, relation), { from, to, relation, weight: 1 })
        const bucket = byEntity.get(entity.id)
        if (bucket === undefined) byEntity.set(entity.id, [record.id])
        else bucket.push(record.id)
      }
    }
    // 共现：共享同一个实体的两条记忆连 related，权重 = 共享实体数。
    const shared = new Map<string, number>()
    for (const ids of byEntity.values()) {
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const id = edgeIdOf({ kind: 'memory', id: ids[i]! }, { kind: 'memory', id: ids[j]! }, 'related')
          shared.set(id, (shared.get(id) ?? 0) + 1)
        }
      }
    }
    for (const [id, weight] of shared) {
      const parts = id.split('|')
      const from = parts[0] === undefined ? undefined : parseNodeKey(parts[0])
      const to = parts[2] === undefined ? undefined : parseNodeKey(parts[2])
      if (from === undefined || to === undefined) continue
      desired.set(id, { from, to, relation: 'related', weight })
    }
    const existingAuto = new Map(
      this.collectEdges().filter((edge) => edge.origin === 'auto').map((edge) => [edge.id, edge] as const),
    )
    const now = Date.now()
    let added = 0
    let removed = 0
    for (const [id, shape] of desired) {
      const auto = existingAuto.get(id)
      const base = auto ?? await this.edges.get(id)
      // 手工 / 模型显式连过同一条边：自动推导不覆盖它。
      if (base !== undefined && base.origin !== 'auto') continue
      if (auto !== undefined && auto.weight === shape.weight) continue
      await this.edges.put(id, {
        id,
        from: shape.from,
        to: shape.to,
        relation: shape.relation,
        note: base?.note ?? '',
        weight: shape.weight,
        origin: 'auto',
        createdAt: base?.createdAt ?? now,
        updatedAt: now,
      })
      added += 1
    }
    for (const edge of existingAuto.values()) {
      if (desired.has(edge.id)) continue
      await this.edges.delete(edge.id)
      removed += 1
    }
    return { added, removed }
  }

  /**
   * 把 memory_save 声明的实体挂上：命中已有实体（名称或别名）就复用，否则按名称
   * 新建一个 concept 实体，然后落一条 about 边（origin=agent，说明是模型自己指的）。
   */
  private async attachEntities(record: MemoryRecord, names: readonly string[] | undefined): Promise<void> {
    if (names === undefined || names.length === 0) return
    const from: MemoryNodeRef = { kind: 'memory', id: record.id }
    for (const raw of names) {
      const name = normalizeEntityName(raw)
      if (name === '') continue
      const entity = await this.upsertEntity({ name })
      await this.link({ from, to: { kind: 'entity', id: entity.id }, relation: 'about', origin: 'agent' })
    }
  }

  /* ---------------- 写 ---------------- */

  /**
   * 语义重叠的落点：同一作用域内（project 需同项目路径，**忽略 kind**）找一条
   * 标题 Dice ≥ MEMORY_OVERLAP_TITLE 或正文 Dice ≥ MEMORY_OVERLAP_CONTENT 的条目。
   * 同名标题已经由 findByTitle 处理，这里兜的是「同一条事换了个说法」。
   */
  private findOverlap(
    incoming: { title: string; content: string },
    scope: MemoryScope,
    projectPath: string,
  ): MemoryRecord | undefined {
    const pathKey = normalizeProjectKey(projectPath)
    let best: MemoryRecord | undefined
    let bestScore = 0
    for (const record of this.collect()) {
      if (record.scope !== scope) continue
      if (scope === 'project' && normalizeProjectKey(record.projectPath) !== pathKey) continue
      const { titleScore, contentScore } = overlapScores(record, incoming)
      if (titleScore < MEMORY_OVERLAP_TITLE && contentScore < MEMORY_OVERLAP_CONTENT) continue
      const score = Math.max(titleScore, contentScore)
      if (best === undefined || score > bestScore
        || (score === bestScore && record.updatedAt > best.updatedAt)) {
        best = record
        bestScore = score
      }
    }
    return best
  }

  /**
   * 就地合并进已有条目：保留原 id 与标题，正文追加、取较大重要性，标签与别名求并集。
   * 摘要只在原来没有时补上（不覆盖已写好的那一行）。
   */
  private async mergeRecord(
    existing: MemoryRecord,
    incoming: {
      title?: string
      content: string
      summary?: string
      aliases?: readonly string[]
      importance?: number
      tags?: readonly string[]
      pinned?: boolean
      exemptParagraph: boolean
    },
  ): Promise<MemoryRecord> {
    const mergedContent = mergeContent(existing.content, incoming.content)
    assertContentWithinLimit(mergedContent)
    if (!incoming.exemptParagraph) assertSingleParagraph(mergedContent)
    const merged: MemoryRecord = {
      ...existing,
      content: mergedContent,
      summary: existing.summary !== '' ? existing.summary : (incoming.summary?.trim() ?? ''),
      aliases: mergeAliases(existing, incoming.title, incoming.aliases),
      importance: Math.max(existing.importance, clampImportance(incoming.importance)),
      tags: normalizeTags([...existing.tags, ...(incoming.tags ?? [])]),
      pinned: incoming.pinned ?? existing.pinned,
      archived: false,
      updatedAt: Date.now(),
    }
    await this.memories.put(merged.id, merged)
    return merged
  }

  /**
   * 写入并回报落点：created=true 是新建；created=false 说明并进了已有条目，
   * mergedBy 区分「同标题」与「语义重叠」（工具据此提示「已合并更新」）。
   */
  async saveWithOutcome(input: MemorySaveInput): Promise<MemorySaveOutcome> {
    const title = input.title.trim()
    if (title === '') throw new Error('memory title is required')
    const content = input.content.trim()
    if (content === '') throw new Error('memory content is required')
    const scope: MemoryScope = input.scope ?? 'global'
    const projectPath = scope === 'project' ? (input.projectPath ?? '').trim() : ''
    if (scope === 'project' && projectPath === '') {
      throw new Error('project-scoped memory requires a project path (workspace directory)')
    }
    const kind: MemoryKind = input.kind ?? 'fact'
    // import 是行式文本解析出来的，不受「单段纯文本」约束；长度上限对所有来源生效。
    const exemptParagraph = (input.source ?? 'agent') === 'import'
    assertContentWithinLimit(content)
    if (!exemptParagraph) assertSingleParagraph(content)
    const summary = input.summary?.trim() ?? ''
    const mergeInput = {
      title,
      content,
      ...(summary !== '' ? { summary } : {}),
      ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      exemptParagraph,
    }
    const existing = this.findByTitle(title, scope, projectPath, kind)
    if (existing !== undefined) {
      const record = await this.mergeRecord(existing, mergeInput)
      await this.attachEntities(record, input.entities)
      await this.syncAutoEdges()
      return { record, created: false, mergedBy: 'title' }
    }
    const overlapped = this.findOverlap({ title, content }, scope, projectPath)
    if (overlapped !== undefined) {
      const record = await this.mergeRecord(overlapped, mergeInput)
      await this.attachEntities(record, input.entities)
      await this.syncAutoEdges()
      return { record, created: false, mergedBy: 'overlap' }
    }
    const now = Date.now()
    const record: MemoryRecord = {
      id: brandString<MemoryId>(randomUUID()),
      kind,
      scope,
      projectPath,
      title,
      content,
      summary,
      aliases: mergeAliases({ title, aliases: [] }, undefined, input.aliases),
      importance: clampImportance(input.importance),
      tags: normalizeTags(input.tags),
      pinned: input.pinned ?? false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      source: input.source ?? 'agent',
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    }
    await this.memories.put(record.id, record)
    // 先挂显式实体（origin=agent），再重算自动边，让共现边把这条也算进去。
    await this.attachEntities(record, input.entities)
    await this.syncAutoEdges()
    return { record, created: true }
  }

  /** 新增或合并一条记忆（同作用域 + 同分类 + 同标题，或语义重叠就地更新）。 */
  async save(input: MemorySaveInput): Promise<MemoryRecord> {
    return (await this.saveWithOutcome(input)).record
  }

  /** 局部修改；改 scope/项目时重新校验归属。 */
  async updateMemory(id: MemoryId, patch: MemoryPatch): Promise<MemoryRecord | undefined> {
    const current = await this.memories.get(id)
    if (current === undefined) return undefined
    const scope: MemoryScope = patch.scope ?? current.scope
    const projectPath = scope === 'project'
      ? (patch.projectPath ?? current.projectPath).trim()
      : ''
    if (scope === 'project' && projectPath === '') {
      throw new Error('project-scoped memory requires a project path (workspace directory)')
    }
    const title = patch.title === undefined ? current.title : patch.title.trim()
    if (title === '') throw new Error('memory title must not be empty')
    const content = patch.content === undefined ? current.content : patch.content.trim()
    if (content === '') throw new Error('memory content must not be empty')
    // 只在真的改正文时过闸门：历史库里可能存着超限 / 多段的旧条目，
    // 它们仍可归档、改标题，不该因为旧数据过不了新闸门而卡死。
    if (patch.content !== undefined) {
      assertContentWithinLimit(content)
      assertSingleParagraph(content)
    }
    const next: MemoryRecord = {
      ...current,
      title,
      content,
      summary: patch.summary === undefined ? current.summary : patch.summary.trim(),
      aliases: patch.aliases === undefined ? current.aliases : mergeAliases(current, undefined, patch.aliases),
      kind: patch.kind ?? current.kind,
      scope,
      projectPath,
      importance: patch.importance === undefined ? current.importance : clampImportance(patch.importance),
      tags: patch.tags === undefined ? current.tags : normalizeTags(patch.tags),
      pinned: patch.pinned ?? current.pinned,
      archived: patch.archived ?? current.archived,
      updatedAt: Date.now(),
    }
    await this.memories.put(next.id, next)
    // 标题 / 摘要 / 正文 / 标签 / 归档态都可能改变提及与共现，统一重算一次。
    await this.syncAutoEdges()
    return next
  }

  /** 归档 / 恢复。 */
  async setArchived(id: MemoryId, archived: boolean): Promise<MemoryRecord | undefined> {
    return this.updateMemory(id, { archived })
  }

  /** 删除一条。 */
  async removeMemory(id: MemoryId): Promise<boolean> {
    const current = await this.memories.get(id)
    if (current === undefined) return false
    await this.memories.delete(id)
    await this.removeEdgesFor({ kind: 'memory', id })
    return true
  }

  /** 重置（清空）某个作用域：全局记忆，或某一个项目的项目记忆。返回清空条数。 */
  async reset(scope: MemoryScope, projectPath?: string): Promise<number> {
    const pathKey = normalizeProjectKey(projectPath ?? '')
    const targets = this.collect().filter((record) => {
      if (record.scope !== scope) return false
      if (scope === 'global') return true
      return normalizeProjectKey(record.projectPath) === pathKey
    })
    for (const record of targets) {
      await this.memories.delete(record.id)
      await this.removeEdgesFor({ kind: 'memory', id: record.id })
    }
    // 同一作用域的原文留档一起清：留档与条目是同一份东西的两段，只删一段会留下孤儿原文。
    for (const doc of this.collectRaw()) {
      if (doc.scope !== scope) continue
      if (scope === 'project' && normalizeProjectKey(doc.projectPath) !== pathKey) continue
      await this.rawDocs.delete(doc.id)
    }
    return targets.length
  }

  /**
   * 导入画像文本：解析分类与条目，按 mode 合并或覆盖目标作用域。
   * 同一份文本内标题重复的条目先自行去重。
   */
  async importText(input: MemoryImportInput): Promise<MemoryImportResult> {
    // 面板导入 = 摄取管线 origin=import 的那条路（原文留档 + 行式解析 + 条目）。
    const result = await this.ingest({
      text: input.text,
      origin: 'import',
      scope: input.scope,
      ...(input.projectPath !== undefined ? { projectPath: input.projectPath } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
    })
    return {
      added: result.added,
      merged: result.merged,
      skipped: result.skipped,
      removed: result.removed,
    }
  }

  /**
   * 整理（进化）：同作用域 + 同分类 + 同标题的重复条目合并成一条，
   * 保留信息最完整者，正文与标签求并集。返回合并/回收条数。
   */
  async tidy(): Promise<{ merged: number; removed: number }> {
    const groups = new Map<string, MemoryRecord[]>()
    for (const record of this.collect()) {
      const key = [
        record.scope,
        normalizeProjectKey(record.projectPath),
        record.kind,
        normalizeProjectKey(record.title),
      ].join('|')
      const bucket = groups.get(key)
      if (bucket === undefined) groups.set(key, [record])
      else bucket.push(record)
    }
    let merged = 0
    let removed = 0
    for (const bucket of groups.values()) {
      if (bucket.length < 2) continue
      bucket.sort((a, b) => b.updatedAt - a.updatedAt)
      const keeper = bucket[0]!
      let content = keeper.content
      const tags = new Set(keeper.tags)
      for (const extra of bucket.slice(1)) {
        const candidate = mergeContent(content, extra.content)
        // 合并不得顶破上限：顶破就保留现有正文（本来与 keeper 同标题），只并标签。
        if (candidate.length <= MEMORY_CONTENT_LIMIT) content = candidate
        for (const tag of extra.tags) tags.add(tag)
      }
      const tidied: MemoryRecord = {
        ...keeper,
        content,
        tags: [...tags],
        aliases: mergeAliases(
          keeper,
          undefined,
          bucket.slice(1).flatMap((item) => [...item.aliases, item.title]),
        ),
        pinned: bucket.some((item) => item.pinned),
        importance: Math.max(...bucket.map((item) => item.importance)),
        updatedAt: Date.now(),
      }
      await this.memories.put(tidied.id, tidied)
      for (const extra of bucket.slice(1)) {
        await this.memories.delete(extra.id)
        await this.removeEdgesFor({ kind: 'memory', id: extra.id })
        removed += 1
      }
      merged += 1
    }
    await this.syncAutoEdges()
    return { merged, removed }
  }
}

/**
 * Typert SRC 标记：手工复刻 @Remote 装饰器产物（同 alpha.3 稳定契约），
 * 避免对标准装饰器转译的依赖。client 端 descriptors 的 method 名必须与之完全一致。
 */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

function markRemoteMethods(prototype: object, methods: readonly string[]): void {
  Object.defineProperty(prototype, REMOTE_METHODS, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(
        methods.map((method) =>
          Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' as const }) }),
        ),
      ),
    }),
  })
}

markRemoteMethods(MemoryService.prototype, [
  'list',
  'getConfig',
  'setConfig',
  'getConflicts',
  'stats',
  'projects',
  'exportText',
  'save',
  'updateMemory',
  'setArchived',
  'removeMemory',
  'reset',
  'importText',
  'tidy',
  'ingest',
  'reingest',
  'rawDocuments',
  'getRawDocument',
  'removeRawDocument',
  'audits',
  'listEntities',
  'upsertEntity',
  'removeEntity',
  'listEdges',
  'link',
  'unlink',
  'neighborhood',
  'rebuildEdges',
])

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}
