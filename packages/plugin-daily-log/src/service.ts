/**
 * ctx.dailyLog：项目（数据源）/报告/模板 CRUD + 按项目聚合多渠道扫描。
 * 数据源 = 一个项目路径；git/dsh/claude/codex 是渠道，命中者全部聚合。
 * 活动统一归属项目名；读取走内存态，写入持久化后生效。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { dailyLogDomain } from './domain.ts'
import type { ChannelProvider } from './sources/provider.ts'
import { detectProjectType } from './sources/detect.ts'
import { discoverSessionProjects } from './sources/discover.ts'
import { BUILTIN_TEMPLATE } from './types.ts'
import type {
  ActivityEntry, DateRange, ProjectCandidate, ProjectChannels, ReportCreateInput,
  ReportId, ReportPrepareInput, ReportPrepareResult, ReportRecord,
  ReportSaveInput, ScanResult, SourceAddInput, SourceId, SourceRecord, TemplateId,
  TemplateRecord,
} from './types.ts'
import { DEFAULT_TEMPLATE_SKELETON, formatDateRange, parseTemplate } from './template.ts'

export interface DailyLogServiceConfig {
  readonly domain: Domain<typeof dailyLogDomain>
  /** dsh 渠道由 host 装配。 */
  readonly channels?: readonly ChannelProvider[]
  readonly workspaceProjects?: () => Promise<Array<{ path: string; title?: string; sessionIds: readonly string[] }>>
  readonly readPreferences?: () => { readonly outputDir?: string; readonly authorEmail?: string }
}

export function normalizePathKey(p: string): string {
  return p.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
}

function defaultSourceLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export class DailyLogService extends TypertRemoteService {
  private readonly sources: KvTable<SourceId, SourceRecord>
  private readonly reports: KvTable<ReportId, ReportRecord>
  private readonly templates: KvTable<TemplateId, TemplateRecord>
  private readonly channels: readonly ChannelProvider[]
  private readonly config: DailyLogServiceConfig
  private migrated = false
  private migrationPromise: Promise<void> | null = null

  constructor(ctx: Context, config: DailyLogServiceConfig) {
    super(ctx, 'dailyLog')
    this.config = config
    this.sources = config.domain.table('sources')
    this.reports = config.domain.table('reports')
    this.templates = config.domain.table('templates')
    this.channels = config.channels ?? []
    // put 的同步段先写内存态，异步段持久化，故此处 void。
    const now = Date.now()
    const builtin = Array.from(this.templates.entries(), ([, t]) => t).find((t) => t.isBuiltin)
    if (!builtin) {
      const seed: TemplateRecord = {
        id: brandString<TemplateId>(randomUUID()),
        name: BUILTIN_TEMPLATE,
        content: DEFAULT_TEMPLATE_SKELETON,
        isBuiltin: true,
        isDefault: true,
        updatedAt: now,
      }
      void this.templates.put(seed.id, seed)
    } else if (builtin.content.includes('{{')) {
      void this.templates.put(builtin.id, { ...builtin, content: DEFAULT_TEMPLATE_SKELETON, updatedAt: now })
    }
  }

  private ensureMigrated(): Promise<void> {
    if (this.migrated) return Promise.resolve()
    this.migrationPromise ??= this.runLegacyMigration()
    return this.migrationPromise
  }

  /**
   * 旧记录迁移：kind=git 转项目记录，其余（会话目录）丢弃——内容可从渠道重取。
   * 仅处理仍带 kind 的记录，故幂等。
   */
  private async runLegacyMigration(): Promise<void> {
    const legacy: Array<{ id: SourceId; record: SourceRecord & { kind?: unknown } }> = []
    for (const [id, s] of this.sources.entries()) {
      const kind = (s as { kind?: unknown }).kind
      if (typeof kind === 'string') legacy.push({ id, record: s })
    }
    if (legacy.length === 0) {
      this.migrated = true
      return
    }
    for (const { id, record } of legacy) {
      if (record.kind !== 'git') {
        await this.sources.delete(id)
        continue
      }
      const clean: SourceRecord = {
        id: record.id,
        type: record.type ?? (await detectProjectType(record.path)),
        label: record.label,
        path: record.path,
        ...(record.author !== undefined ? { author: record.author } : {}),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }
      await this.sources.put(id, clean)
    }
    this.migrated = true
  }

  async listSources(): Promise<SourceRecord[]> {
    await this.ensureMigrated()
    return Array.from(this.sources.entries(), ([, s]) => s)
  }

  async addSource(input: SourceAddInput): Promise<SourceRecord> {
    await this.ensureMigrated()
    const path = input.path.trim()
    if (!path) throw new Error('路径不能为空')
    if (Array.from(this.sources.entries(), ([, s]) => s).some((s) => normalizePathKey(s.path) === normalizePathKey(path))) {
      throw new Error('该项目已在数据源中')
    }
    const now = Date.now()
    const record: SourceRecord = {
      id: brandString<SourceId>(randomUUID()),
      type: input.type ?? (await detectProjectType(path)),
      label: input.label?.trim() || defaultSourceLabel(path),
      path,
      ...(input.author !== undefined && input.author !== '' ? { author: input.author.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    }
    await this.sources.put(record.id, record)
    return record
  }

  async removeSource(id: SourceId): Promise<boolean> {
    await this.ensureMigrated()
    return this.sources.delete(id)
  }

  private async probeChannels(path: string): Promise<ProjectChannels> {
    const out: ProjectChannels = { git: false, dsh: false, claude: false, codex: false }
    for (const ch of this.channels) {
      try {
        if (await ch.probe(path)) out[ch.kind] = true
      } catch {
        // 渠道探测失败视为未命中
      }
    }
    return out
  }

  private hasSourcePath(path: string): boolean {
    const key = normalizePathKey(path)
    return Array.from(this.sources.entries(), ([, s]) => s).some((s) => normalizePathKey(s.path) === key)
  }

  async listWorkspaceCandidates(): Promise<ProjectCandidate[]> {
    await this.ensureMigrated()
    const projects = (await this.config.workspaceProjects?.()) ?? []
    const out: ProjectCandidate[] = []
    for (const p of projects) {
      const channels = await this.probeChannels(p.path)
      // dsh 渠道未接入，故徽标恒为暗。
      out.push({
        path: p.path,
        title: p.title || defaultSourceLabel(p.path),
        type: await detectProjectType(p.path),
        channels,
        detail: p.sessionIds.length > 0 ? p.sessionIds.length + ' 个 DSH 会话（DSH 源未接入）' : undefined,
        added: this.hasSourcePath(p.path),
      })
    }
    return out
  }

  async discoverSessionProjects(): Promise<ProjectCandidate[]> {
    await this.ensureMigrated()
    const found = await discoverSessionProjects()
    const out: ProjectCandidate[] = []
    for (const f of found) {
      const channels: ProjectChannels = { git: false, dsh: false, claude: f.claude, codex: f.codex }
      out.push({
        path: f.path,
        title: defaultSourceLabel(f.path),
        type: await detectProjectType(f.path),
        channels,
        detail: f.sessionCount > 0 ? `${f.sessionCount} 个会话` : undefined,
        added: this.hasSourcePath(f.path),
      })
    }
    return out
  }

  /** 单渠道异常不中断整体，错误汇入 truncatedHint。 */
  async scanSource(id: SourceId, range: DateRange): Promise<ScanResult> {
    await this.ensureMigrated()
    const source = this.sources.get(id)
    if (!source) throw new Error(`source ${id} not found`)
    const entries: ActivityEntry[] = []
    const errors: string[] = []
    for (const ch of this.channels) {
      let hit = false
      try {
        hit = await ch.probe(source.path)
      } catch {
        hit = false
      }
      if (!hit) continue
      try {
        const author = this.resolveGitAuthor(source)
        const got = await ch.scan({
          path: source.path,
          label: source.label,
          range,
          ...(author !== undefined ? { author } : {}),
        })
        entries.push(...got.map((e) => ({ ...e, sourceLabel: source.label, channel: ch.kind })))
      } catch (e) {
        errors.push(`[${ch.kind}] ${errText(e)}`)
      }
    }
    return {
      sourceId: id,
      entries,
      truncated: errors.length > 0,
      ...(errors.length > 0 ? { truncatedHint: errors.join('；') } : {}),
    }
  }

  listReports(): ReportRecord[] {
    return Array.from(this.reports.entries(), ([, r]) => r)
  }

  getReport(id: ReportId): ReportRecord | undefined {
    return this.reports.get(id)
  }

  async createReport(input: ReportCreateInput): Promise<ReportRecord> {
    const now = Date.now()
    const record: ReportRecord = {
      id: brandString<ReportId>(randomUUID()),
      title: input.title,
      markdown: input.markdown,
      sourceIds: input.sourceIds,
      ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
      ...(input.reportType !== undefined ? { reportType: input.reportType } : {}),
      dateRange: input.dateRange,
      createdAt: now,
    }
    await this.reports.put(record.id, record)
    return record
  }

  async deleteReport(id: ReportId): Promise<boolean> {
    return this.reports.delete(id)
  }

  private resolveTemplate(templateId?: TemplateId): TemplateRecord | undefined {
    if (templateId !== undefined) return this.templates.get(templateId)
    return this.listTemplates().find((t) => t.isDefault) ?? this.listTemplates().find((t) => t.isBuiltin)
  }

  /** 只解析模板，不扫描；scan 结果由 agent 侧提供。 */
  async prepareReport(input: ReportPrepareInput): Promise<ReportPrepareResult> {
    const ids = input.sourceIds ?? Array.from(this.sources.entries(), ([, s]) => s.id)
    const template = this.resolveTemplate(input.templateId)
    const parts = parseTemplate(template?.content ?? DEFAULT_TEMPLATE_SKELETON)
    return {
      reportType: input.reportType,
      dateRange: input.dateRange,
      sourceIds: ids,
      sourceCount: ids.length,
      template: {
        name: template?.name ?? BUILTIN_TEMPLATE,
        ...(parts.promptSection !== null ? { promptSection: parts.promptSection } : {}),
        skeletonSection: parts.skeletonSection,
      },
    }
  }

  async saveReport(input: ReportSaveInput): Promise<ReportRecord> {
    const markdown = input.markdown.trim()
    if (!markdown) throw new Error('报告正文不能为空')
    return this.createReport({
      title: input.title?.trim() || (input.reportType ?? '报告') + ' · ' + formatDateRange(input.dateRange),
      markdown,
      sourceIds: input.sourceIds,
      ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
      ...(input.reportType !== undefined ? { reportType: input.reportType } : {}),
      dateRange: input.dateRange,
    })
  }

  /** 返回导出文件的绝对路径。 */
  async exportReport(id: ReportId, outputDir?: string): Promise<string> {
    const report = this.reports.get(id)
    if (!report) throw new Error('report ' + id + ' not found')
    const dir = outputDir?.trim() || this.configuredOutputDir() || join(homedir(), 'daily-log-reports')
    await mkdir(dir, { recursive: true })
    const safe = report.title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'report'
    const filePath = join(dir, safe + '.md')
    await writeFile(filePath, report.markdown, 'utf8')
    return filePath
  }

  /** 未配置或读取抛错时为空串。 */
  private configuredOutputDir(): string {
    try {
      const value = this.config.readPreferences?.()?.outputDir
      return typeof value === 'string' ? value.trim() : ''
    } catch {
      return ''
    }
  }

  /** 未配置或读取抛错时为空串。 */
  private configuredAuthorEmail(): string {
    try {
      const value = this.config.readPreferences?.()?.authorEmail
      return typeof value === 'string' ? value.trim() : ''
    } catch {
      return ''
    }
  }

  /**
   * 返回 undefined 时由 git 渠道回落仓库 user.email。
   * `*` / `all` 由渠道解释为放开全作者。
   */
  private resolveGitAuthor(source: SourceRecord): string | undefined {
    const explicit = source.author?.trim()
    if (explicit) return explicit
    return this.configuredAuthorEmail() || undefined
  }

  listTemplates(): TemplateRecord[] {
    return Array.from(this.templates.entries(), ([, t]) => t)
  }

  getTemplate(id: TemplateId): TemplateRecord | undefined {
    return this.templates.get(id)
  }

  async createTemplate(input: { name: string; content: string }): Promise<TemplateRecord> {
    const name = input.name.trim()
    if (!name) throw new Error('模板名不能为空')
    if (name === BUILTIN_TEMPLATE) throw new Error(`"${BUILTIN_TEMPLATE}" 是内置模板，不可创建`)
    if (Array.from(this.templates.entries(), ([, t]) => t).some((t) => t.name === name)) {
      throw new Error(`模板 "${name}" 已存在`)
    }
    const now = Date.now()
    const record: TemplateRecord = {
      id: brandString<TemplateId>(randomUUID()),
      name,
      content: input.content,
      isBuiltin: false,
      isDefault: false,
      updatedAt: now,
    }
    await this.templates.put(record.id, record)
    return record
  }

  async updateTemplate(
    id: TemplateId,
    patch: { name?: string; content?: string },
  ): Promise<TemplateRecord | undefined> {
    const current = this.templates.get(id)
    if (!current) return undefined
    if (current.isBuiltin) throw new Error('内置模板不可更新')
    const now = Date.now()
    let name = current.name
    if (patch.name !== undefined) {
      name = patch.name.trim()
      if (!name) throw new Error('模板名不能为空')
      if (name === BUILTIN_TEMPLATE) throw new Error(`"${BUILTIN_TEMPLATE}" 是内置模板，不可使用`)
      if (name !== current.name && Array.from(this.templates.entries(), ([, t]) => t).some((t) => t.id !== id && t.name === name)) {
        throw new Error(`模板 "${name}" 已存在`)
      }
    }
    const next: TemplateRecord = {
      ...current,
      name,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      updatedAt: now,
    }
    await this.templates.put(id, next)
    return next
  }

  async deleteTemplate(id: TemplateId): Promise<boolean> {
    const current = this.templates.get(id)
    if (!current) return false
    if (current.isBuiltin) throw new Error('内置模板不可删除')
    return this.templates.delete(id)
  }

  async setDefaultTemplate(id: TemplateId): Promise<boolean> {
    const target = this.templates.get(id)
    if (!target) return false
    const now = Date.now()
    for (const [tid, t] of this.templates.entries()) {
      if (t.isDefault && tid !== id) {
        await this.templates.put(tid, { ...t, isDefault: false, updatedAt: now })
      }
    }
    await this.templates.put(id, { ...target, isDefault: true, updatedAt: now })
    return true
  }
}

/**
 * 手工复刻 @Remote 装饰器产物，避免构建依赖标准装饰器转译。
 * 下方 method 名必须与 client 端 descriptors 完全一致。
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

markRemoteMethods(DailyLogService.prototype, [
  'listSources',
  'addSource',
  'removeSource',
  'scanSource',
  'listWorkspaceCandidates',
  'discoverSessionProjects',
  'listReports',
  'getReport',
  'deleteReport',
  'exportReport',
  'listTemplates',
  'getTemplate',
  'createTemplate',
  'updateTemplate',
  'deleteTemplate',
  'setDefaultTemplate',
])

declare module '@deepseek-ai/cordis' {
  interface Context {
    dailyLog: DailyLogService
  }
}
