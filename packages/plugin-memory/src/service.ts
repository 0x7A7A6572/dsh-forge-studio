/**
 * ctx.memory：记忆库读写核心；读取走 storage-domain 内存态，写入经后端持久化后生效。
 * 同时是 Typert Gateway 的 Remote 服务（SRC 标记，无 codegen）。
 * 端点参数必须是纯标识符：不得默认值 / 解构 / rest。
 */

import { randomUUID } from 'node:crypto'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { memoryDomain } from './domain.ts'
import { edgeKey } from './storage-key.ts'
import { MEMORY_KINDS, MEMORY_KIND_LABELS, MEMORY_SYMMETRIC_RELATIONS } from './types.ts'
import type { MemorySettingsAccess } from './settings.ts'
import type {
  MemoryAuditEntry, MemoryAuditInput, MemoryAuditQuery, MemoryConfig, MemoryEdge,
  MemoryEdgeQuery, MemoryEdgeRelation, MemoryEntity, MemoryEntityId, MemoryEntityInput,
  MemoryEntityKind, MemoryEntityQuery, MemoryEntityRef, MemoryGraphNode, MemoryId, MemoryImportInput,
  MemoryImportResult, MemoryIngestInput, MemoryIngestResult, MemoryKind, MemoryLinkInput, MemoryModelGroup,
  MemoryNeighborhood, MemoryPatch, MemoryConflict, MemoryNodeRef,
  MemoryProjectSummary, MemoryQuery, MemoryRawDocument, MemoryRawId, MemoryRawInput, MemoryRawQuery,
  MemoryRecord, MemorySaveInput, MemoryScope, MemoryStats,
} from './types.ts'
import { validateMemoryBundle } from './bundle.ts'
import { MEMORY_BUNDLE_SCHEMA, MEMORY_BUNDLE_VERSION } from './types.ts'
import type { MemoryBundle, MemoryBundleImportInput, MemoryBundleImportResult } from './types.ts'

export const MEMORY_RAW_LIMIT = 200
export const MEMORY_AUDIT_LIMIT = 500
export const MEMORY_CONTENT_LIMIT = 320
export const IMPORT_IMPORTANCE = 4
/** 正文 Dice 达到此值即视为同一条。 */
export const MEMORY_OVERLAP_CONTENT = 0.7
/** 标题 Dice 达到此值即视为同一条。 */
export const MEMORY_OVERLAP_TITLE = 0.9
/** 「疑似同一条」提示的下限。 */
export const MEMORY_NEAR_FLOOR = 0.4
/** 交给模型判定的相似度下限。 */
export const MEMORY_JUDGE_FLOOR = 0.2
export const MEMORY_JUDGE_MAX_CANDIDATES = 3

function amountOf(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.round(value))
}

export function normalizeProjectKey(path: string): string {
  return path.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
}

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

function assertContentWithinLimit(text: string): void {
  if (text.length <= MEMORY_CONTENT_LIMIT) return
  throw new Error(
    '记忆内容超出上限：当前 ' + text.length + ' 字，上限 ' + MEMORY_CONTENT_LIMIT
    + ' 字。请精简后再写入（同标题合并后的总长也受此限制）。',
  )
}


/** 只用于比较，不写回库。 */
function flattenToParagraph(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

/** 新内容已包含在旧内容里就保留旧的，否则另起一段接上。 */
export function mergeContent(previous: string, incoming: string): string {
  const oldText = previous.trim()
  const newText = incoming.trim()
  const oldFlat = flattenToParagraph(oldText)
  const newFlat = flattenToParagraph(newText)
  if (newFlat === '') return oldText
  if (oldFlat === '') return newText
  if (oldFlat.includes(newFlat)) return oldText
  if (newFlat.includes(oldFlat)) return newText
  return oldText + '\n\n' + newText
}

export function normalizeMemoryText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

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

export const MEMORY_ENTITY_MIN_CHARS = 2

export function normalizeEntityName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function entityNameKey(name: string): string {
  return normalizeEntityName(name).toLowerCase()
}

export function nodeKey(ref: MemoryNodeRef): string {
  return ref.kind + ':' + ref.id
}

/** 格式非法返回 undefined，不抛错。 */
export function parseNodeKey(key: string): MemoryNodeRef | undefined {
  const index = key.indexOf(':')
  if (index <= 0) return undefined
  const kind = key.slice(0, index)
  if (kind !== 'memory' && kind !== 'entity') return undefined
  return { kind, id: key.slice(index + 1) }
}

function compareNodeKey(a: MemoryNodeRef, b: MemoryNodeRef): number {
  const left = nodeKey(a)
  const right = nodeKey(b)
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** 边的确定性 id：同端点+关系恒等，对称关系先排序端点。 */
export function edgeIdOf(from: MemoryNodeRef, to: MemoryNodeRef, relation: MemoryEdgeRelation): string {
  const symmetric = MEMORY_SYMMETRIC_RELATIONS.includes(relation)
  const [left, right] = symmetric && compareNodeKey(from, to) > 0 ? [to, from] : [from, to]
  return nodeKey(left) + '|' + relation + '|' + nodeKey(right)
}

export function defaultEdgeRelation(from: MemoryNodeRef, to: MemoryNodeRef): MemoryEdgeRelation {
  return from.kind === 'memory' && to.kind === 'entity' ? 'about' : 'related'
}

export function compareEdges(a: MemoryEdge, b: MemoryEdge): number {
  if (a.relation !== b.relation) return a.relation < b.relation ? -1 : 1
  if (a.weight !== b.weight) return b.weight - a.weight
  return b.updatedAt - a.updatedAt
}

export function compareEntities(a: MemoryEntity, b: MemoryEntity): number {
  if (a.archived !== b.archived) return a.archived ? 1 : -1
  return a.name.localeCompare(b.name, 'zh-Hans-CN')
}

/** 并入的标题与显式别名求并集，剔掉与本体标题相同的写法。 */
export function mergeAliases(
  record: { title: string; aliases: readonly string[] },
  title: string | undefined,
  extra: readonly string[] | undefined,
): string[] {
  const own = entityNameKey(record.title)
  const candidates = [...record.aliases, ...(title !== undefined ? [title] : []), ...(extra ?? [])]
  return normalizeTags(candidates).filter((alias) => entityNameKey(alias) !== own)
}

export interface MemoryOverlapText {
  readonly title: string
  readonly content: string
}

export function overlapScores(
  existing: MemoryOverlapText,
  incoming: MemoryOverlapText,
): { titleScore: number; contentScore: number } {
  return {
    titleScore: bigramDice(normalizeMemoryText(existing.title), normalizeMemoryText(incoming.title)),
    contentScore: bigramDice(normalizeMemoryText(existing.content), normalizeMemoryText(incoming.content)),
  }
}

export function compareMemories(a: MemoryRecord, b: MemoryRecord): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.importance !== b.importance) return b.importance - a.importance
  return b.updatedAt - a.updatedAt
}

export interface ParsedMemoryItem {
  readonly title: string
  readonly content: string
  readonly kind: MemoryKind
}

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
  const plain = /^([\u4e00-\u9fa5A-Za-z]{2,6})[：:]$/.exec(trimmed)
  if (plain) return plain[1] ?? undefined
  return undefined
}

function kindOfHeading(heading: string): MemoryKind | undefined {
  return SECTION_KINDS[heading.trim()]
}

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

/** 吃画像（分类标题 + 日期行）与任意纯文本；代码块围栏与注释行忽略。 */
export function parseImportedText(text: string): ParsedMemoryItem[] {
  const items: ParsedMemoryItem[] = []
  let current: MemoryKind = 'fact'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('```') || line.startsWith('<!--')) continue
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
      // 认不出分类的标题一律跳过，不当裸行收。
      continue
    }
    items.push({ title: titleOf(line), content: line, kind: current })
  }
  return items
}

/** 标题重复的保留先出现的那个。 */
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

export function rawFreshness(doc: MemoryRawDocument): number {
  return doc.updatedAt > 0 ? doc.updatedAt : doc.createdAt
}

export function compareRawDocuments(a: MemoryRawDocument, b: MemoryRawDocument): number {
  return rawFreshness(b) - rawFreshness(a)
}

export function prunableRawIds(docs: readonly MemoryRawDocument[], limit: number): MemoryRawId[] {
  if (limit <= 0) return docs.map((doc) => doc.id)
  if (docs.length <= limit) return []
  return [...docs].sort(compareRawDocuments).slice(limit).map((doc) => doc.id)
}

export type MemoryMergeReason = 'title' | 'overlap' | 'judge'

export type MemoryJudgeDecision = 'add' | 'update' | 'skip'

/** 已按相似度降序，最多 MEMORY_JUDGE_MAX_CANDIDATES 条。 */
export interface MemoryJudgeCandidate {
  readonly id: MemoryId
  readonly kind: MemoryKind
  readonly title: string
  readonly content: string
  /** 标题 / 正文 Dice 取大者。 */
  readonly score: number
}

export interface MemoryJudgeRequest {
  readonly title: string
  readonly content: string
  readonly summary: string
  readonly scope: MemoryScope
  readonly projectPath: string
  readonly candidates: readonly MemoryJudgeCandidate[]
}

export interface MemoryJudgeVerdict {
  readonly decision: MemoryJudgeDecision
  readonly targetId?: MemoryId
  readonly reason?: string
  readonly meta?: {
    readonly ok: boolean
    readonly provider: string
    readonly model: string
    readonly durationMs: number
    readonly inputChars: number
    readonly outputChars: number
    readonly tokensIn?: number
    readonly tokensOut?: number
    readonly error?: string
  }
}

/** 返回 undefined = 本次没判定。 */
export type MemoryJudge = (request: MemoryJudgeRequest) => Promise<MemoryJudgeVerdict | undefined>

/** 没自动合并，但附近有很像的一条。 */
export interface MemorySuspect {
  readonly id: MemoryId
  readonly title: string
  readonly score: number
}

export interface MemorySaveOutcome {
  readonly record: MemoryRecord
  readonly created: boolean
  readonly mergedBy?: MemoryMergeReason
  /** 判定为已覆盖没写入；record 即那条已有记忆。 */
  readonly skipped?: boolean
  readonly judged?: { readonly decision: MemoryJudgeDecision; readonly targetId?: MemoryId; readonly reason?: string }
  readonly suspect?: MemorySuspect
}

export interface MemoryServiceConfig {
  readonly domain: Domain<typeof memoryDomain>
  /** 工作区候选（ctx.workspaceRegistry），面板下拉用。 */
  readonly knownWorkspaces?: () => Promise<readonly string[]>
  /** 面板开关读写同一命名空间。 */
  readonly settings?: MemorySettingsAccess
}

export class MemoryService extends TypertRemoteService {
  private readonly memories: KvTable<MemoryId, MemoryRecord>
  private readonly rawDocs: KvTable<MemoryRawId, MemoryRawDocument>
  private readonly auditRows: KvTable<string, MemoryAuditEntry>
  /** 边是关联的唯一真相来源，两侧都不冗余存邻居。 */
  private readonly entities: KvTable<MemoryEntityId, MemoryEntity>
  private readonly edges: KvTable<string, MemoryEdge>
  private readonly config: MemoryServiceConfig

  /** tools 桥探测到的重名冲突，空表示无冲突。 */
  private conflicts: MemoryConflict[] = []
  /** 判定钩子（agent 层注入）；没有就只走阈值 + 疑似提示。 */
  private judge: MemoryJudge | undefined
  private modelCatalog: (() => Promise<readonly MemoryModelGroup[]>) | undefined

  constructor(ctx: Context, config: MemoryServiceConfig) {
    super(ctx, 'memory')
    this.config = config
    this.memories = config.domain.table('memories')
    this.rawDocs = config.domain.table('raw_documents')
    this.auditRows = config.domain.table('audits')
    this.entities = config.domain.table('entities')
    this.edges = config.domain.table('edges')
  }

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
        // 单条不合格只跳过，不让整批导入失败。
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
        // 命中别名 = 同一条。
        || record.aliases.some((alias) => normalizeProjectKey(alias) === key)))
  }

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

  async getConfig(): Promise<MemoryConfig> {
    if (this.config.settings !== undefined) return this.config.settings.get()
    // 兜底值必须与 MEMORY_CONFIG_BASE 保持一致。
    return {
      autoCapture: true,
      autoInject: true,
      maxInjected: 6,
      importanceThreshold: 4,
      captureEveryTurns: 3,
      captureMaxTurns: 4,
      captureMaxChars: 4000,
      captureIncludeAssistant: false,
      llmProvider: '',
      llmModel: '',
    }
  }

  async setConfig(patch: Partial<MemoryConfig>): Promise<MemoryConfig> {
    if (this.isLocked()) {
      throw new Error('检测到另一个记忆插件占用了 memory_* 工具名，本插件已被锁定，无法开启。请先在「插件」里停用另一个记忆插件，再重启 dsh。')
    }
    if (this.config.settings === undefined) throw new Error('配置服务尚未就绪，请稍后再试')
    await this.config.settings.update(patch)
    return this.config.settings.get()
  }

  /** 模型目录来自 dsh LLM 注册表（见 agent/models.ts）；拿不到一律返回空数组。 */
  async models(): Promise<readonly MemoryModelGroup[]> {
    if (this.modelCatalog === undefined) return []
    try {
      return await this.modelCatalog()
    } catch {
      return []
    }
  }

  setModelCatalog(source: (() => Promise<readonly MemoryModelGroup[]>) | undefined): void {
    this.modelCatalog = source
  }

  setConflicts(conflicts: readonly MemoryConflict[]): void {
    this.conflicts = [...conflicts]
  }

  setJudge(judge: MemoryJudge | undefined): void {
    this.judge = judge
  }

  private judgeReady(): boolean {
    return this.judge !== undefined
  }

  /** 判定抛错只当没有判定。 */
  private async runJudge(request: MemoryJudgeRequest): Promise<MemoryJudgeVerdict | undefined> {
    if (this.judge === undefined) return undefined
    try {
      return await this.judge(request)
    } catch {
      return undefined
    }
  }

  private async recordJudgeAudit(verdict: MemoryJudgeVerdict, sessionId?: string): Promise<void> {
    const meta = verdict.meta
    if (meta === undefined) return
    const note = meta.error ?? verdict.reason
    try {
      await this.recordAudit({
        kind: 'judge',
        provider: meta.provider,
        model: meta.model,
        ok: meta.ok,
        durationMs: meta.durationMs,
        inputChars: meta.inputChars,
        outputChars: meta.outputChars,
        ...(meta.tokensIn !== undefined ? { tokensIn: meta.tokensIn } : {}),
        ...(meta.tokensOut !== undefined ? { tokensOut: meta.tokensOut } : {}),
        recordIds: verdict.targetId !== undefined ? [verdict.targetId] : [],
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(note !== undefined ? { error: note } : {}),
      })
    } catch { /* 审计写不进去不该影响这次写入 */ }
  }

  private findInScope(id: MemoryId, scope: MemoryScope, projectPath: string): MemoryRecord | undefined {
    const pathKey = normalizeProjectKey(projectPath)
    return this.collect().find((record) => record.id === id
      && record.scope === scope
      && (scope !== 'project' || normalizeProjectKey(record.projectPath) === pathKey))
  }

  async getConflicts(): Promise<MemoryConflict[]> {
    return [...this.conflicts]
  }

  /** 检测到别的记忆插件占用 memory_* 即锁死本插件。 */
  isLocked(): boolean {
    return this.conflicts.length > 0
  }

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

  /** 导出格式与导入提示词同构。 */
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
        lines.push('- [' + date + '] ' + record.content.replace(/\n/g, '\n  '))
      }
      lines.push('')
    }
    if (records.length === 0) lines.push('（暂无记忆）', '')
    return lines.join('\n').trimEnd()
  }

  injectCandidates(sessionCwd: string | undefined, options: { maxItems: number; threshold: number }): MemoryRecord[] {
    // 被锁时一条都不注入。
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

  /** 标题清单，供自动提炼参考；同步只读。 */
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

  /** mode=replace 时先清空目标作用域（连带其旧留档）。 */
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

  /** 重跑抽取，不新建留档。 */
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

  async storeRawDocument(input: MemoryRawInput): Promise<MemoryRawDocument> {
    if (input.text.trim() === '') throw new Error('raw document text must not be empty')
    const scope = input.scope
    const projectPath = scope === 'project' ? (input.projectPath ?? '').trim() : ''
    if (scope === 'project' && projectPath === '') {
      throw new Error('project-scoped raw document requires a project path (workspace directory)')
    }
    const now = Date.now()
    const title = (input.title ?? rawTitleOf(input.text)).trim()
    // 转录按会话归并，后一轮覆盖前一轮（转录本身是累积的）。
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

  async markExtracted(rawId: MemoryRawId, recordIds: readonly string[]): Promise<MemoryRawDocument | undefined> {
    const current = await this.rawDocs.get(rawId)
    if (current === undefined) return undefined
    const merged = [...current.recordIds]
    for (const id of recordIds) if (!merged.includes(id)) merged.push(id)
    const next: MemoryRawDocument = { ...current, recordIds: merged, extractedAt: Date.now() }
    await this.rawDocs.put(next.id, next)
    return next
  }

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

  async getRawDocument(rawId: MemoryRawId): Promise<MemoryRawDocument | undefined> {
    return this.rawDocs.get(rawId)
  }

  /** 已抽出的条目不跟着删。 */
  async removeRawDocument(rawId: MemoryRawId): Promise<boolean> {
    const current = await this.rawDocs.get(rawId)
    if (current === undefined) return false
    await this.rawDocs.delete(rawId)
    return true
  }

  async pruneRawDocuments(limit: number): Promise<number> {
    const ids = prunableRawIds(this.collectRaw(), limit)
    for (const id of ids) await this.rawDocs.delete(id)
    return ids.length
  }

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

  private findEntity(ref: string): MemoryEntity | undefined {
    const key = entityNameKey(ref)
    return this.collectEntities().find((entity) =>
      entity.id === ref
      || entityNameKey(entity.name) === key
      || entity.aliases.some((alias) => entityNameKey(alias) === key))
  }

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

  /** 带 id 就地更新；不带 id 时按名称 / 别名并入，否则新建。 */
  async upsertEntity(input: MemoryEntityInput): Promise<MemoryEntity> {
    const name = normalizeEntityName(input.name)
    if (name === '') throw new Error('entity name is required')
    const now = Date.now()
    const aliases = normalizeTags(input.aliases)
    const existing = input.id === undefined
      ? this.findEntity(name)
      : await this.entities.get(brandString<MemoryEntityId>(input.id))
    if (existing !== undefined) {
      // 只有显式带 id 才算改名，否则把这次的写法登记成别名。
      const renamed = input.id !== undefined
      const nextName = renamed ? name : existing.name
      const sameName = entityNameKey(name) === entityNameKey(existing.name)
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

  async removeEntity(id: MemoryEntityId): Promise<boolean> {
    const current = await this.entities.get(id)
    if (current === undefined) return false
    await this.entities.delete(id)
    for (const edge of this.collectEdges()) {
      if (edge.from.kind === 'entity' && edge.from.id === id) { await this.edges.delete(edgeKey(edge.id)); continue }
      if (edge.to.kind === 'entity' && edge.to.id === id) await this.edges.delete(edgeKey(edge.id))
    }
    await this.syncAutoEdges()
    return true
  }

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

  /** 幂等：同端点+关系是同一条边；两端点必须真实存在。 */
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
    const existing = await this.edges.get(edgeKey(id))
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
        // 自动边被显式连过即升级为显式边，重算不再覆盖。
        origin: existing.origin === 'auto' && input.origin !== undefined && input.origin !== 'auto'
          ? input.origin
          : existing.origin,
        updatedAt: now,
      }
    await this.edges.put(edgeKey(edge.id), edge)
    return edge
  }

  async unlink(id: string): Promise<boolean> {
    const current = await this.edges.get(edgeKey(id))
    if (current === undefined) return false
    await this.edges.delete(edgeKey(id))
    return true
  }

  private async removeEdgesFor(ref: MemoryNodeRef): Promise<void> {
    const key = nodeKey(ref)
    for (const edge of this.collectEdges()) {
      if (nodeKey(edge.from) !== key && nodeKey(edge.to) !== key) continue
      await this.edges.delete(edgeKey(edge.id))
    }
  }

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

  async rebuildEdges(): Promise<{ added: number; removed: number }> {
    return this.syncAutoEdges()
  }

  private async resolveNode(ref: MemoryNodeRef): Promise<MemoryGraphNode | undefined> {
    if (ref.kind === 'memory') {
      const record = await this.memories.get(brandString<MemoryId>(ref.id))
      if (record === undefined) return undefined
      return {
        ref: { kind: 'memory', id: record.id },
        label: record.title,
        kind: record.kind,
        archived: record.archived,
        scope: record.scope,
        projectPath: record.projectPath,
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

  /** 标题或标签命中算强命中（about 边），否则 mentions 边。 */
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
   * 自动边重算：先算期望集合，再与已有自动边求差集，只写变化的几条。
   * 显式连过的边不被覆盖，也不被清理。
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
    // 共现：共享实体的两条记忆连 related，权重 = 共享实体数。
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
      const base = auto ?? await this.edges.get(edgeKey(id))
      if (base !== undefined && base.origin !== 'auto') continue
      if (auto !== undefined && auto.weight === shape.weight) continue
      await this.edges.put(edgeKey(id), {
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
      await this.edges.delete(edgeKey(edge.id))
      removed += 1
    }
    return { added, removed }
  }

  private async attachEntities(record: MemoryRecord, refs: readonly (string | MemoryEntityRef)[] | undefined): Promise<void> {
    if (refs === undefined || refs.length === 0) return
    const from: MemoryNodeRef = { kind: 'memory', id: record.id }
    // 同名合并成一次 upsert：后到的 kind 补上，名字写法用先到的。
    const desired = new Map<string, { name: string; kind?: MemoryEntityKind }>()
    for (const raw of refs) {
      const ref = typeof raw === 'string' ? { name: raw } : raw
      const name = normalizeEntityName(ref.name)
      if (name === '') continue
      const key = entityNameKey(name)
      const previous = desired.get(key)
      const kind = ref.kind ?? previous?.kind
      desired.set(key, { name: previous?.name ?? name, ...(kind !== undefined ? { kind } : {}) })
    }
    for (const item of desired.values()) {
      const entity = await this.upsertEntity({ name: item.name, ...(item.kind !== undefined ? { kind: item.kind } : {}) })
      await this.link({ from, to: { kind: 'entity', id: entity.id }, relation: 'about', origin: 'agent' })
    }
  }

  /** 同一作用域内按 Dice 找最像的一条；忽略 kind。 */
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

  private findNearest(
    incoming: { title: string; content: string },
    scope: MemoryScope,
    projectPath: string,
    floor: number,
    limit = MEMORY_JUDGE_MAX_CANDIDATES,
  ): { record: MemoryRecord; score: number; candidates: MemoryJudgeCandidate[] } | undefined {
    const pathKey = normalizeProjectKey(projectPath)
    const scored: Array<{ record: MemoryRecord; score: number }> = []
    for (const record of this.collect()) {
      if (record.scope !== scope) continue
      if (scope === 'project' && normalizeProjectKey(record.projectPath) !== pathKey) continue
      const { titleScore, contentScore } = overlapScores(record, incoming)
      const score = Math.max(titleScore, contentScore)
      if (score < floor) continue
      scored.push({ record, score })
    }
    if (scored.length === 0) return undefined
    scored.sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt)
    const top = scored.slice(0, Math.max(1, limit))
    const head = top[0]!
    return {
      record: head.record,
      score: head.score,
      candidates: top.map((entry) => ({
        id: entry.record.id,
        kind: entry.record.kind,
        title: entry.record.title,
        content: entry.record.content,
        score: entry.score,
      })),
    }
  }

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
    },
  ): Promise<MemoryRecord> {
    const mergedContent = mergeContent(existing.content, incoming.content)
    assertContentWithinLimit(mergedContent)
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
    assertContentWithinLimit(content)
    const summary = input.summary?.trim() ?? ''
    const mergeInput = {
      title,
      content,
      ...(summary !== '' ? { summary } : {}),
      ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
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
    const near = this.findNearest({ title, content }, scope, projectPath, MEMORY_JUDGE_FLOOR)
    let judged: MemorySaveOutcome['judged']
    // source=import 不判定：批量导入会放大调用次数。
    const judgeAllowed = (input.source ?? 'agent') !== 'import'
    if (judgeAllowed && near !== undefined && this.judgeReady()) {
      const verdict = await this.runJudge({
        title, content, summary, scope, projectPath, candidates: near.candidates,
      })
      if (verdict !== undefined) {
        judged = {
          decision: verdict.decision,
          ...(verdict.targetId !== undefined ? { targetId: verdict.targetId } : {}),
          ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
        }
        await this.recordJudgeAudit(verdict, input.sessionId)
        const target = verdict.targetId !== undefined
          ? this.findInScope(verdict.targetId, scope, projectPath)
          : undefined
        if (verdict.decision === 'update' && target !== undefined) {
          try {
            const record = await this.mergeRecord(target, mergeInput)
            await this.attachEntities(record, input.entities)
            await this.syncAutoEdges()
            return { record, created: false, mergedBy: 'judge', judged }
          } catch {
            // 合并撞上限就退化成新建，不丢掉这次写入。
          }
        }
        if (verdict.decision === 'skip' && target !== undefined) {
          // 不写入，record 回已有那条。
          return { record: target, created: false, mergedBy: 'judge', skipped: true, judged }
        }
      }
    }
    // 判定成功即以判定结论为准，不再提示疑似。
    const suspect: MemorySuspect | undefined = judged === undefined
      && near !== undefined && near.score >= MEMORY_NEAR_FLOOR
      ? { id: near.record.id, title: near.record.title, score: near.score }
      : undefined
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
    // 先挂显式实体再重算自动边，共现边才算得上这条。
    await this.attachEntities(record, input.entities)
    await this.syncAutoEdges()
    // 判定跑过就带回结论，调用方能区分「模型看过」与「附近没有像的」。
    return {
      record,
      created: true,
      ...(judged !== undefined ? { judged } : {}),
      ...(suspect !== undefined ? { suspect } : {}),
    }
  }

  async save(input: MemorySaveInput): Promise<MemoryRecord> {
    return (await this.saveWithOutcome(input)).record
  }

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
    // 只在真的改正文时过闸门：旧库里可能有超限的历史条目。
    if (patch.content !== undefined) {
      assertContentWithinLimit(content)
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
    await this.syncAutoEdges()
    return next
  }

  async setArchived(id: MemoryId, archived: boolean): Promise<MemoryRecord | undefined> {
    return this.updateMemory(id, { archived })
  }

  async removeMemory(id: MemoryId): Promise<boolean> {
    const current = await this.memories.get(id)
    if (current === undefined) return false
    await this.memories.delete(id)
    await this.removeEdgesFor({ kind: 'memory', id })
    return true
  }

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
    // 同作用域的留档一起清，否则留下孤儿原文。
    for (const doc of this.collectRaw()) {
      if (doc.scope !== scope) continue
      if (scope === 'project' && normalizeProjectKey(doc.projectPath) !== pathKey) continue
      await this.rawDocs.delete(doc.id)
    }
    return targets.length
  }

  async importText(input: MemoryImportInput): Promise<MemoryImportResult> {
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

  /** 全库快照：含归档记忆、实体与边，不分页不筛选。 */
  async exportBundle(): Promise<MemoryBundle> {
    return {
      schema: MEMORY_BUNDLE_SCHEMA,
      version: MEMORY_BUNDLE_VERSION,
      exportedAt: Date.now(),
      records: this.collect(),
      entities: Array.from(this.entities.entries(), ([, entity]) => entity),
      edges: Array.from(this.edges.entries(), ([, edge]) => edge),
    }
  }

  /** replace 不动原文留档：备份载荷里没有它，删了就是丢数据。 */
  async importBundle(input: MemoryBundleImportInput): Promise<MemoryBundleImportResult> {
    const payload = validateMemoryBundle(input.bundle)
    let removed = 0
    if (input.mode === 'replace') {
      for (const record of this.collect()) {
        await this.memories.delete(record.id)
        removed += 1
      }
      for (const [id] of this.entities.entries()) await this.entities.delete(id)
      for (const [id] of this.edges.entries()) await this.edges.delete(id)
    }
    let added = 0
    let merged = 0
    for (const incoming of payload.records) {
      const existing = this.memories.get(incoming.id)
      if (existing === undefined) {
        await this.memories.put(incoming.id, incoming)
        added += 1
      } else {
        if (incoming.updatedAt > existing.updatedAt) await this.memories.put(incoming.id, incoming)
        merged += 1
      }
    }
    for (const entity of payload.entities) await this.entities.put(entity.id, entity)
    // 边必须走 edgeKey 落盘（逻辑 id 不是 path-safe 的键）。
    for (const edge of payload.edges) {
      const key = edgeKey(edge.id)
      const existing = await this.edges.get(key)
      if (existing === undefined || edge.updatedAt > existing.updatedAt) await this.edges.put(key, edge)
    }
    await this.syncAutoEdges()
    return { added, merged, removed }
  }

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
        // 顶破上限就只并标签，正文不变。
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

/** 手工复刻 @Remote 产物；清单必须与 client 端 descriptors 的 method 名一致。 */
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
  'models',
  'getConflicts',
  'stats',
  'projects',
  'exportText',
  'exportBundle',
  'save',
  'updateMemory',
  'setArchived',
  'removeMemory',
  'reset',
  'importText',
  'importBundle',
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
