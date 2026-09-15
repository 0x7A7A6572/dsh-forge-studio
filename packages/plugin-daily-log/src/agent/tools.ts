/**
 * plugin-daily-log × agent harness 桥（host 侧）—— 数据源/扫描/报告/模板工具注册。
 *
 * 把 ctx.dailyLog（DailyLogService，同 ctx 直调）暴露成 agent 工具：
 * - 读工具（list_sources / scan / list_reports / get_report / list_templates / get_template /
 *   prepare_report）放行；
 * - 写工具（add_source / save_report / export_report / delete_report / template_*）在宿主有
 *   approval seam 且会话有效策略为 ask（会真正弹确认）时经 tools/pre-execute 弹确认；
 *   无 seam、策略为 never（禁弹窗，ask 会被 ApprovalService 确定性拒绝）时放行 ——
 *   判定见 dailyLogWriteShouldAsk；
 * - guard（单调拒绝）：内置模板不可修改/删除（service 已兜底，此处提前拒绝）。
 *
 * 全局只注册 guard、tools/pre-execute 钩子与恒驻的 daily_log 派发器；15 个 daily_log_*
 * 工具本身经 ToolGate 按 agent 按需注入（详见 index.ts 的 createDailyLogGate）。
 * 工具以 tools 服务判存后条件挂载（ctx.inject），纯 UI 宿主照常工作（不注册工具）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { DailyLogService } from '../service.ts'
import { SOURCE_KINDS } from '../types.ts'
import type { ActivityEntry, ReportId, SourceId, TemplateId } from '../types.ts'
import { filterEntries, renderScan } from './scan-render.ts'
import type { ScanLevel } from './scan-render.ts'
import { createDailyLogDispatcher } from './tool-dispatcher.ts'
import type { ToolGate } from './tool-gate.ts'

export const DAILY_LOG_TOOL_PREFIX = 'daily_log_'

const TOOL_LIST_SOURCES = DAILY_LOG_TOOL_PREFIX + 'list_sources'
const TOOL_SCAN = DAILY_LOG_TOOL_PREFIX + 'scan'
const TOOL_LIST_REPORTS = DAILY_LOG_TOOL_PREFIX + 'list_reports'
const TOOL_GET_REPORT = DAILY_LOG_TOOL_PREFIX + 'get_report'
const TOOL_LIST_TEMPLATES = DAILY_LOG_TOOL_PREFIX + 'list_templates'
const TOOL_GET_TEMPLATE = DAILY_LOG_TOOL_PREFIX + 'get_template'
const TOOL_ADD_SOURCE = DAILY_LOG_TOOL_PREFIX + 'add_source'
const TOOL_PREPARE = DAILY_LOG_TOOL_PREFIX + 'prepare_report'
const TOOL_SAVE = DAILY_LOG_TOOL_PREFIX + 'save_report'
const TOOL_EXPORT = DAILY_LOG_TOOL_PREFIX + 'export_report'
const TOOL_DELETE_REPORT = DAILY_LOG_TOOL_PREFIX + 'delete_report'
const TOOL_TEMPLATE_CREATE = DAILY_LOG_TOOL_PREFIX + 'template_create'
const TOOL_TEMPLATE_UPDATE = DAILY_LOG_TOOL_PREFIX + 'template_update'
const TOOL_TEMPLATE_DELETE = DAILY_LOG_TOOL_PREFIX + 'template_delete'
const TOOL_TEMPLATE_SET_DEFAULT = DAILY_LOG_TOOL_PREFIX + 'set_default_template'

export function isDailyLogTool(name: string): boolean {
  return name.startsWith(DAILY_LOG_TOOL_PREFIX)
}

const WRITE_TOOLS = new Set<string>([
  TOOL_ADD_SOURCE, TOOL_SAVE, TOOL_EXPORT, TOOL_DELETE_REPORT,
  TOOL_TEMPLATE_CREATE, TOOL_TEMPLATE_UPDATE, TOOL_TEMPLATE_DELETE, TOOL_TEMPLATE_SET_DEFAULT,
])

function describeAction(tool: string): string {
  switch (tool) {
    case TOOL_ADD_SOURCE: return 'add a data source'
    case TOOL_SAVE: return 'save a generated report'
    case TOOL_EXPORT: return 'export a report to a markdown file'
    case TOOL_DELETE_REPORT: return 'delete a report'
    case TOOL_TEMPLATE_CREATE: return 'create a template'
    case TOOL_TEMPLATE_UPDATE: return 'update a template'
    case TOOL_TEMPLATE_DELETE: return 'delete a template'
    case TOOL_TEMPLATE_SET_DEFAULT: return 'change the default template'
    default: return 'write'
  }
}

/** 'ask' | 'never' —— 与 @deepseek-ai/dsh-user-approval 的 ApprovalPolicy 同形。 */
type DailyLogApprovalPolicy = 'ask' | 'never'

/**
 * pre-execute ask 门禁判定（纯函数，供单测）：
 * - policy === undefined：宿主未装配 approval（无 seam）→ 放行（保持原语义）；
 * - policy === 'never'：会话禁弹窗，ApprovalService 对一切 ask 确定性返回
 *   'rejected'（decide 在分发应答器之前直接拒绝）→ 弹确认只会让用户已在对话中
 *   确认的写操作被自动拒绝，等同「无交互通道」，放行；
 * - policy === 'ask'：宿主会真正弹确认 → 写工具先 ask。
 */
export function dailyLogWriteShouldAsk(policy: DailyLogApprovalPolicy | undefined): boolean {
  return policy === 'ask'
}

/** 扫描工具描述里对 level 的说明（与 scan-render 的口径一致）。 */
const SCAN_LEVEL_HINT =
  'level=index (default) lists one row per session/branch group, so rows track groups rather than messages; ' +
  'level=summary adds each group first question and last answer; level=raw lists every entry. ' +
  'Collapsed groups are always listed with names and counts, never silently dropped.'

/** 15 个工具的名字（顺序与注册顺序一致）。 */
export const DAILY_LOG_TOOL_NAMES: readonly string[] = [
  TOOL_LIST_SOURCES, TOOL_SCAN, TOOL_LIST_REPORTS, TOOL_GET_REPORT, TOOL_LIST_TEMPLATES,
  TOOL_GET_TEMPLATE, TOOL_ADD_SOURCE, TOOL_PREPARE, TOOL_SAVE, TOOL_EXPORT,
  TOOL_DELETE_REPORT, TOOL_TEMPLATE_CREATE, TOOL_TEMPLATE_UPDATE, TOOL_TEMPLATE_DELETE,
  TOOL_TEMPLATE_SET_DEFAULT,
]

/**
 * 构造全部 daily_log_* 工具定义，交给 register 决定注册到哪个 scope。
 * 定义期只闭包 svc，不调用它 —— 因此可在 gate 里按 agent 生成新的一组。
 */
export function buildDailyLogTools(
  svc: DailyLogService,
  register: (definition: ToolDefinition) => void,
): void {
  /* ----- 读工具 ----- */

  register(defineTool({
    name: TOOL_LIST_SOURCES,
    description: 'List daily-log projects (one project = one unique directory path; git / DSH / Claude / Codex channels aggregate per project). Returns id, type, label, path.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                type: { type: 'string', required: true, enum: ['code', 'other'] },
                label: { type: 'string', required: true },
                path: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const list = (value as { sources: Array<{ id: string; type: string; label: string; path: string }> }).sources
        if (list.length === 0) return [{ type: 'text', text: '(no projects)' }]
        return [{ type: 'text', text: list.map((s) => '- ' + s.id + ' · [' + s.type + '] ' + s.label + ' (' + s.path + ')').join('\n') }]
      },
    },
    async execute() {
      const all = await svc.listSources()
      return { sources: all.map((s) => ({ id: s.id, type: s.type, label: s.label, path: s.path })) }
    },
  }))

  register(defineTool({
    name: TOOL_SCAN,
    description: 'Scan data sources for activity entries (git commits / conversation turns) within a date range. '
      + 'Omit source_id to scan all sources; returns the entries plus a count. '
      + SCAN_LEVEL_HINT,
    parameters: {
      source_id: { type: 'string', description: 'Optional source id; omit to scan all sources.' },
      since: { type: 'string', required: true, description: 'Start date, e.g. "2026-06-30" or "Monday".' },
      until: { type: 'string', description: 'Optional end date, e.g. "2026-07-05".' },
      level: {
        type: 'string',
        enum: ['index', 'summary', 'raw'],
        description: 'Rendering level (default index): index=per-session/branch overview, summary=index + first question & last answer per group, raw=every entry.',
      },
      session_id: { type: 'string', description: 'Drill-down: only entries of sessions/branches whose id or title contains this string.' },
      keywords: { type: 'string', description: 'Drill-down: only entries whose text contains any of these space/comma separated terms.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ts: { type: 'number', required: true },
                sourceLabel: { type: 'string', required: true },
                channel: { type: 'string', enum: SOURCE_KINDS },
                kind: { type: 'string', required: true, enum: ['commit', 'conversation'] },
                title: { type: 'string', required: true },
                body: { type: 'string', required: true },
                group: { type: 'string' },
                groupTitle: { type: 'string' },
                role: { type: 'string', enum: ['user', 'assistant'] },
              },
            },
          },
          count: { type: 'number', required: true },
        },
      },
      render: (args, value) =>
        [{ type: 'text', text: renderScan((value as { entries: ActivityEntry[] }).entries, { level: args.level as ScanLevel | undefined }) }],
    },
    async execute(args) {
      const since = args.since as string
      const until = args.until as string | undefined
      const range = { since, ...(until ? { until } : {}) }
      const list = await svc.listSources()
      const targets = args.source_id !== undefined
        ? list.filter((s) => s.id === (args.source_id as SourceId))
        : list
      const entries: ActivityEntry[] = []
      for (const s of targets) {
        const r = await svc.scanSource(s.id, range)
        entries.push(...r.entries)
      }
      // 下钻过滤在渲染与结构化返回上同时生效，避免显示与取值不一致。
      const filtered = filterEntries(entries, {
        ...(args.session_id !== undefined ? { sessionId: args.session_id as string } : {}),
        ...(args.keywords !== undefined ? { keywords: args.keywords as string } : {}),
      })
      return { entries: filtered, count: filtered.length }
    },
  }))

  register(defineTool({
    name: TOOL_LIST_REPORTS,
    description: 'List generated daily-log reports; returns id, title, dateRange and createdAt per report.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reports: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                dateRange: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    since: { type: 'string', required: true },
                    until: { type: 'string' },
                  },
                },
                createdAt: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const list = (value as { reports: Array<{ id: string; title: string; createdAt: number }> }).reports
        if (list.length === 0) return [{ type: 'text', text: '(no reports)' }]
        return [{ type: 'text', text: list.map((r) => '- ' + r.id + ' · ' + r.title).join('\n') }]
      },
    },
    async execute() {
      return { reports: svc.listReports().map((r) => ({ id: r.id, title: r.title, dateRange: r.dateRange, createdAt: r.createdAt })) }
    },
  }))

  register(defineTool({
    name: TOOL_GET_REPORT,
    description: 'Read one generated report by id; returns its title and full markdown body.',
    parameters: { report_id: { type: 'string', required: true, description: 'The report id from daily_log_list_reports.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', required: true }, markdown: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: (value as { markdown: string }).markdown }],
    },
    async execute(args) {
      const r = svc.getReport(args.report_id as ReportId)
      if (!r) throw new Error('report ' + args.report_id + ' not found')
      return { title: r.title, markdown: r.markdown }
    },
  }))

  register(defineTool({
    name: TOOL_LIST_TEMPLATES,
    description: 'List report templates; returns id, name, isBuiltin and isDefault per template. The default template is used when daily_log_prepare_report omits template_id.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          templates: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                isBuiltin: { type: 'boolean', required: true },
                isDefault: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const list = (value as { templates: Array<{ id: string; name: string; isBuiltin: boolean; isDefault: boolean }> }).templates
        return [{ type: 'text', text: list.map((t) => '- ' + t.id + ' · ' + t.name + (t.isBuiltin ? ' (builtin)' : '') + (t.isDefault ? ' (default)' : '')).join('\n') }]
      },
    },
    async execute() {
      return { templates: svc.listTemplates().map((t) => ({ id: t.id, name: t.name, isBuiltin: t.isBuiltin, isDefault: t.isDefault })) }
    },
  }))

  register(defineTool({
    name: TOOL_GET_TEMPLATE,
    description: 'Read one report template by id; returns its name and full markdown content.',
    parameters: { template_id: { type: 'string', required: true, description: 'The template id from daily_log_list_templates.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, content: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: (value as { content: string }).content }],
    },
    async execute(args) {
      const t = svc.getTemplate(args.template_id as TemplateId)
      if (!t) throw new Error('template ' + args.template_id + ' not found')
      return { name: t.name, content: t.content }
    },
  }))

  /* ----- 写工具 ----- */

  register(defineTool({
    name: TOOL_ADD_SOURCE,
    description: 'Add a project: one unique directory path (a git repo or any project directory). All channels that hit the path (git commits / DSH / Claude / Codex sessions) aggregate at scan time. Returns the new source id, label and type.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the project directory.' },
      label: { type: 'string', description: 'Optional display label.' },
      author: { type: 'string', description: 'Optional git author filter (git commits only). Defaults to the repo user.email (own commits only); pass "*" for all authors.' },
      type: { type: 'string', enum: ['code', 'other'], description: 'Optional project type; auto-detected when omitted (has .git → code).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, label: { type: 'string', required: true }, type: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: 'added project ' + (value as { id: string }).id }],
    },
    async execute(args) {
      const s = await svc.addSource({
        path: args.path as string,
        ...(args.label !== undefined ? { label: args.label as string } : {}),
        ...(args.author !== undefined ? { author: args.author as string } : {}),
        ...(args.type !== undefined ? { type: args.type as 'code' | 'other' } : {}),
      })
      return { id: s.id, label: s.label, type: s.type }
    },
  }))

  /* prepare_report：进入生成阶段，返回模板引导（只读，不扫描） */

  register(defineTool({
    name: TOOL_PREPARE,
    description: 'Enter the generation phase: resolves the selected template guidance (instruction section + skeleton section) and the source count without scanning again. Returns templateName, skeletonSection and sourceCount; write the report body yourself following that skeleton.',
    parameters: {
      reportType: { type: 'string', required: true, description: 'Report type label, e.g. 日报 / 周报 / 月报.' },
      since: { type: 'string', required: true, description: 'Start date, e.g. "2026-06-30".' },
      until: { type: 'string', description: 'Optional end date.' },
      source_ids: { type: 'array', items: { type: 'string' }, description: 'Optional source ids; omit to use all sources.' },
      template_id: { type: 'string', description: 'Optional template id; omit to use the default template.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          templateName: { type: 'string', required: true },
          skeletonSection: { type: 'string', required: true },
          sourceCount: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const v = value as { templateName: string; skeletonSection: string; sourceCount: number }
        return [{ type: 'text', text: 'template: ' + v.templateName + ' (sources: ' + v.sourceCount + ')\n\n骨架：\n' + v.skeletonSection.slice(0, 600) }]
      },
    },
    async execute(args) {
      const r = await svc.prepareReport({
        reportType: args.reportType as string,
        dateRange: { since: args.since as string, ...(args.until !== undefined ? { until: args.until as string } : {}) },
        ...(args.source_ids !== undefined ? { sourceIds: args.source_ids as SourceId[] } : {}),
        ...(args.template_id !== undefined ? { templateId: args.template_id as TemplateId } : {}),
      })
      return { templateName: r.template.name, skeletonSection: r.template.skeletonSection, sourceCount: r.sourceCount }
    },
  }))

  /* save_report：把 LLM 撰写的正文落 reports 表（写，ask） */

  register(defineTool({
    name: TOOL_SAVE,
    description: 'Save a report the model authored (full markdown body) into the reports table. Only call after the user has confirmed the report shown in chat. Returns the new report id and title.',
    parameters: {
      markdown: { type: 'string', required: true, description: 'The full markdown body the model wrote.' },
      title: { type: 'string', description: 'Optional report title; defaults to reportType + date range.' },
      reportType: { type: 'string', description: 'Report type label (stored on the record), e.g. 周报.' },
      since: { type: 'string', required: true, description: 'Start date, e.g. "2026-06-30".' },
      until: { type: 'string', description: 'Optional end date.' },
      source_ids: { type: 'array', items: { type: 'string' }, required: true, description: 'Source ids the report covers.' },
      template_id: { type: 'string', description: 'Optional template id used for generation.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, title: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: 'saved report ' + (value as { id: string }).id }],
    },
    async execute(args) {
      const r = await svc.saveReport({
        markdown: args.markdown as string,
        ...(args.title !== undefined ? { title: args.title as string } : {}),
        ...(args.reportType !== undefined ? { reportType: args.reportType as string } : {}),
        dateRange: { since: args.since as string, ...(args.until !== undefined ? { until: args.until as string } : {}) },
        sourceIds: (args.source_ids as SourceId[]) ?? [],
        ...(args.template_id !== undefined ? { templateId: args.template_id as TemplateId } : {}),
      })
      return { id: r.id, title: r.title }
    },
  }))

  /* export_report：把已存报告导出为 .md（写，ask） */

  register(defineTool({
    name: TOOL_EXPORT,
    description: 'Export an existing report (report_id from daily_log_list_reports) to a markdown file under the configured output directory, or ~/daily-log-reports if none is set. Returns the written path.',
    parameters: {
      report_id: { type: 'string', required: true, description: 'The report id.' },
      output_dir: { type: 'string', description: 'Optional output directory; defaults to the configured one or ~/daily-log-reports.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: 'exported to ' + (value as { path: string }).path }],
    },
    async execute(args) {
      const path = await svc.exportReport(args.report_id as ReportId, args.output_dir !== undefined ? (args.output_dir as string) : undefined)
      return { path }
    },
  }))

  register(defineTool({
    name: TOOL_DELETE_REPORT,
    description: 'Delete one report by id; returns whether a report was deleted.',
    parameters: { report_id: { type: 'string', required: true, description: 'The report id from daily_log_list_reports.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { deleted: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.deleted ? 'deleted' : 'not found' }],
    },
    async execute(args) {
      return { deleted: await svc.deleteReport(args.report_id as ReportId) }
    },
  }))

  register(defineTool({
    name: TOOL_TEMPLATE_CREATE,
    description: 'Create a report template: Markdown with an optional instruction section, the DATA marker (<!-- DATA -->), and a required skeleton section guiding the generation phase (no mustache placeholders). Returns the new template id and name.',
    parameters: {
      name: { type: 'string', required: true, description: 'Template name.' },
      content: { type: 'string', required: true, description: 'Template content: optional instruction section above <!-- DATA --> and required skeleton section below it, guiding the LLM as it writes the report body (no mustache placeholders).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: 'created template ' + (value as { id: string }).id }],
    },
    async execute(args) {
      const t = await svc.createTemplate({ name: args.name as string, content: args.content as string })
      return { id: t.id, name: t.name }
    },
  }))

  register(defineTool({
    name: TOOL_TEMPLATE_UPDATE,
    description: 'Update the name and/or content of a template by id; returns the updated template id and name.',
    parameters: {
      template_id: { type: 'string', required: true, description: 'The template id from daily_log_list_templates.' },
      name: { type: 'string', description: 'New name.' },
      content: { type: 'string', description: 'New content.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: 'updated template ' + (value as { id: string }).id }],
    },
    async execute(args) {
      const t = await svc.updateTemplate(args.template_id as TemplateId, {
        ...(args.name !== undefined ? { name: args.name as string } : {}),
        ...(args.content !== undefined ? { content: args.content as string } : {}),
      })
      if (!t) throw new Error('template ' + args.template_id + ' not found')
      return { id: t.id, name: t.name }
    },
  }))

  register(defineTool({
    name: TOOL_TEMPLATE_DELETE,
    description: 'Delete a template by id; returns whether a template was deleted. The builtin default template cannot be deleted.',
    parameters: { template_id: { type: 'string', required: true, description: 'The template id from daily_log_list_templates.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { deleted: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.deleted ? 'deleted' : 'not found' }],
    },
    async execute(args) {
      return { deleted: await svc.deleteTemplate(args.template_id as TemplateId) }
    },
  }))

  register(defineTool({
    name: TOOL_TEMPLATE_SET_DEFAULT,
    description: 'Set a template as the default (the one used when daily_log_prepare_report omits template_id); returns whether the template existed.',
    parameters: { template_id: { type: 'string', required: true, description: 'The template id from daily_log_list_templates.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.ok ? 'set' : 'not found' }],
    },
    async execute(args) {
      return { ok: await svc.setDefaultTemplate(args.template_id as TemplateId) }
    },
  }))
}

/**
 * 全局只装 guard + tools/pre-execute 钩子，以及恒注册的派发器；
 * 15 个 daily_log_* 工具与详细引导段改由 ToolGate 按 agent 按需注入
 * （见 index.ts 的 createDailyLogGate），不再出现在全局 scope。
 */
export function installDailyLogTools(ctx: Context, gate: ToolGate): void {
  const svc = ctx.dailyLog

  // guard（单调拒绝）：内置模板不可修改/删除（service 已兜底，此处提前拒绝）。
  ctx.tools.guard((exec) => {
    if (exec.name !== TOOL_TEMPLATE_DELETE && exec.name !== TOOL_TEMPLATE_UPDATE) return undefined
    const args = exec.arguments as { template_id?: unknown } | undefined
    const id = args?.template_id
    if (typeof id !== 'string') return undefined
    const t = svc.listTemplates().find((x) => x.id === id)
    if (t?.isBuiltin) return 'template ' + id + ' is the builtin default and cannot be modified or deleted'
    return undefined
  })

  // pre-execute ask：宿主有 approval seam 且会话有效策略为 ask（会真正弹确认）时，
  // 写工具先弹确认；策略 never（禁弹窗 → ApprovalService 确定性拒绝一切 ask）或
  // 无 agent 可路由时放行 —— 避免用户已在对话中确认的操作仍被自动拒绝。
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!isDailyLogTool(exec.name)) return next()
    if (!WRITE_TOOLS.has(exec.name)) return next()
    const approval = ctx.get('approval')
    if (approval === undefined) return next()
    const policy = exec.agent === undefined
      ? undefined
      : approval.overrideOf(exec.agent.session) ?? approval.config.policy ?? 'ask'
    if (!dailyLogWriteShouldAsk(policy)) return next()
    return { kind: 'ask', reason: 'The agent wants to ' + describeAction(exec.name) + ' in daily-log.' }
  })

  // 派发器恒注册：模型唯一的按需发现入口（其余 15 个工具默认不注册）。
  ctx.tools.register(createDailyLogDispatcher(gate))
}
