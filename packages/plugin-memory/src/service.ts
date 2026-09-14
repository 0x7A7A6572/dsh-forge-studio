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
import { MEMORY_KINDS, MEMORY_KIND_LABELS } from './types.ts'
import type { MemorySettingsAccess } from './settings.ts'
import type {
  MemoryAuditEntry, MemoryAuditInput, MemoryAuditQuery, MemoryConfig, MemoryId, MemoryImportInput,
  MemoryImportResult, MemoryIngestInput, MemoryIngestResult, MemoryKind, MemoryPatch, MemoryConflict,
  MemoryProjectSummary, MemoryQuery, MemoryRawDocument, MemoryRawId, MemoryRawInput, MemoryRawQuery,
  MemoryRecord, MemorySaveInput, MemoryScope, MemoryStats,
} from './types.ts'

/** 原文留档保留上限（超出按最旧清理）：转录很长，不能无限堆在 KV 里。 */
export const MEMORY_RAW_LIMIT = 200
/** 审计保留上限。 */
export const MEMORY_AUDIT_LIMIT = 500
/** 摄取条目的默认重要性（用户主动整理过的内容，高于自动提炼的 3）。 */
export const IMPORT_IMPORTANCE = 4

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

/** 同一条目的重复写入：新内容已包含在旧内容里就保留旧的，否则追加一行。 */
export function mergeContent(previous: string, incoming: string): string {
  const oldText = previous.trim()
  const newText = incoming.trim()
  if (newText === '') return oldText
  if (oldText === '') return newText
  if (oldText.includes(newText)) return oldText
  if (newText.includes(oldText)) return newText
  return oldText + '\n' + newText
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
  private readonly config: MemoryServiceConfig

  /** 与其它记忆插件的重名冲突（tools 桥探测后回填；空表示无冲突）。 */
  private conflicts: MemoryConflict[] = []

  constructor(ctx: Context, config: MemoryServiceConfig) {
    super(ctx, 'memory')
    this.config = config
    this.memories = config.domain.table('memories')
    this.rawDocs = config.domain.table('raw_documents')
    this.auditRows = config.domain.table('audits')
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

  /** 把解析出来的条目写进记忆库（同作用域 + 同分类 + 同标题就地合并）。 */
  private async applyItems(
    items: readonly ParsedMemoryItem[],
    target: { scope: MemoryScope; projectPath: string; source: string; importance: number },
  ): Promise<{ added: number; merged: number; recordIds: string[] }> {
    let added = 0
    let merged = 0
    const recordIds: string[] = []
    for (const item of items) {
      const existing = this.findByTitle(item.title, target.scope, target.projectPath, item.kind)
      const saved = await this.save({
        title: item.title,
        content: item.content,
        kind: item.kind,
        scope: target.scope,
        ...(target.projectPath !== '' ? { projectPath: target.projectPath } : {}),
        importance: target.importance,
        source: target.source,
      })
      recordIds.push(saved.id)
      if (existing === undefined) added += 1
      else merged += 1
    }
    return { added, merged, recordIds }
  }

  private findByTitle(title: string, scope: MemoryScope, projectPath: string, kind: MemoryKind): MemoryRecord | undefined {
    const key = normalizeProjectKey(title)
    const pathKey = normalizeProjectKey(projectPath)
    return this.collect().find((record) =>
      record.kind === kind
      && record.scope === scope
      && normalizeProjectKey(record.projectPath) === pathKey
      && normalizeProjectKey(record.title) === key)
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
        const hay = (record.title + '\n' + record.content + '\n' + record.tags.join(' ')).toLowerCase()
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
    return { autoCapture: true, autoInject: true, maxInjected: 6, importanceThreshold: 3 }
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
      skipped: parsed.skipped,
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
      skipped: parsed.skipped,
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
  async getRawDocument(id: MemoryRawId): Promise<MemoryRawDocument | undefined> {
    return this.rawDocs.get(id)
  }

  /** 删掉一份原文留档（已抽出的条目不动）。 */
  async removeRawDocument(id: MemoryRawId): Promise<boolean> {
    const current = await this.rawDocs.get(id)
    if (current === undefined) return false
    await this.rawDocs.delete(id)
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

  /* ---------------- 写 ---------------- */

  /** 新增或合并一条记忆（同作用域 + 同分类 + 同标题就地更新）。 */
  async save(input: MemorySaveInput): Promise<MemoryRecord> {
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
    const now = Date.now()
    const existing = this.findByTitle(title, scope, projectPath, kind)
    if (existing !== undefined) {
      const merged: MemoryRecord = {
        ...existing,
        content: mergeContent(existing.content, content),
        importance: Math.max(existing.importance, clampImportance(input.importance)),
        tags: normalizeTags([...existing.tags, ...(input.tags ?? [])]),
        pinned: input.pinned ?? existing.pinned,
        archived: false,
        updatedAt: now,
      }
      await this.memories.put(merged.id, merged)
      return merged
    }
    const record: MemoryRecord = {
      id: brandString<MemoryId>(randomUUID()),
      kind,
      scope,
      projectPath,
      title,
      content,
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
    return record
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
    const next: MemoryRecord = {
      ...current,
      title,
      content,
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
    for (const record of targets) await this.memories.delete(record.id)
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
        content = mergeContent(content, extra.content)
        for (const tag of extra.tags) tags.add(tag)
      }
      const tidied: MemoryRecord = {
        ...keeper,
        content,
        tags: [...tags],
        pinned: bucket.some((item) => item.pinned),
        importance: Math.max(...bucket.map((item) => item.importance)),
        updatedAt: Date.now(),
      }
      await this.memories.put(tidied.id, tidied)
      for (const extra of bucket.slice(1)) {
        await this.memories.delete(extra.id)
        removed += 1
      }
      merged += 1
    }
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
])

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}
