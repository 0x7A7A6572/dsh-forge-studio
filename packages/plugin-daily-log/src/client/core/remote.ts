/**
 * daily-log 远程通道（client → host，Typert Gateway 直连，不走会话）：
 * host 侧 DailyLogService 以 SRC 标记模式暴露 dailyLog/* 端点（见 service.ts）。
 * 本文件手写对应的 client 贡献：ctx.remote.$mount 后即可 ctx.remote.dailyLog.listSources() 等。
 *
 * 约束（两处必须与 host 一致）：
 * - 端点 method 名 = host 方法名；
 * - 参数 wire 名 = host 方法形参名（input/id/range/patch）；
 * - 参数个数：client API 层**没有「可选形参」概念** —— descriptor 声明的形参必须逐个传值，
 *   缺省语义用 undefined 占位（host 收到 undefined 即走缺省值）。少传一个即抛
 *   `client api: <端点> expected N argument(s), got M`；类型上也照此写成必填
 *   （`string | undefined`，不是 `string?`），让漏传在 typecheck 就红。
 * 参数 codec 用 strict（client API 层强制），result 用 src-json（透传）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertCodec,
  TypertRemoteContribution,
  TypertRemoteNamespace,
  TypertSchema,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  DateRange, ProjectCandidate, ReportId, ReportRecord, ScanResult,
  SourceAddInput, SourceId, SourceRecord, TemplateId, TemplateRecord,
} from '../../types.ts'

export const DAILY_LOG_REMOTE_PACKAGE = '@zzerx/dsh-plugin-daily-log'
const SERVICE = 'dailyLog'
const NAMESPACE = 'dailyLog'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** strict codec（手写，无需 zod；只做形状校验）。 */
function strict<T>(typeSymbol: string, schema: TypertSchema<T>): TypertCodec {
  return { mode: 'strict', typeSymbol, schema }
}

/** 宽松对象 codec：client 侧只校验「是对象」，字段校验交给 host service。 */
function loose<T>(typeSymbol: string): TypertCodec {
  return strict<T>(typeSymbol, {
    parse(value) {
      if (!isRecord(value)) throw new Error('expected object')
      return value as T
    },
  })
}

const idSchema: TypertSchema<string> = {
  parse(value) {
    if (typeof value !== 'string' || value.length === 0) throw new Error('expected non-empty id string')
    return value
  },
}

/** 结果一律 src-json（client 不解析返回值，host SRC 模式透传）。 */
const json: TypertCodec = { mode: 'src-json' }

function descriptor(method: string, parameters: InvocationDescriptor['parameters']): InvocationDescriptor {
  return {
    id: NAMESPACE + '.' + method,
    service: SERVICE,
    namespace: NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: json,
  }
}

const optionalString: TypertCodec = strict<string | undefined>('string?', {
  parse(value) {
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw new Error('expected string')
    return value
  },
})

const id = (): TypertCodec => strict('id', idSchema)

export const dailyLogRemoteContribution: TypertRemoteContribution = {
  package: DAILY_LOG_REMOTE_PACKAGE,
  descriptors: [
    descriptor('listSources', []),
    descriptor('addSource', [{ name: 'input', wire: 'input', source: 'json', codec: loose<SourceAddInput>('SourceAddInput') }]),
    descriptor('removeSource', [{ name: 'id', wire: 'id', source: 'json', codec: id() }]),
    descriptor('scanSource', [
      { name: 'id', wire: 'id', source: 'json', codec: id() },
      { name: 'range', wire: 'range', source: 'json', codec: loose<DateRange>('DateRange') },
    ]),
    descriptor('listWorkspaceCandidates', []),
    descriptor('discoverSessionProjects', []),
    descriptor('listReports', []),
    descriptor('getReport', [{ name: 'id', wire: 'id', source: 'json', codec: id() }]),
    descriptor('deleteReport', [{ name: 'id', wire: 'id', source: 'json', codec: id() }]),
    descriptor('exportReport', [
      { name: 'id', wire: 'id', source: 'json', codec: id() },
      { name: 'outputDir', wire: 'outputDir', source: 'json', codec: optionalString },
    ]),
    descriptor('listTemplates', []),
    descriptor('getTemplate', [{ name: 'id', wire: 'id', source: 'json', codec: id() }]),
    descriptor('createTemplate', [{ name: 'input', wire: 'input', source: 'json', codec: loose<{ name: string; content: string }>('TemplateCreateInput') }]),
    descriptor('updateTemplate', [
      { name: 'id', wire: 'id', source: 'json', codec: id() },
      { name: 'patch', wire: 'patch', source: 'json', codec: loose<{ name?: string; content?: string }>('TemplateUpdateInput') },
    ]),
    descriptor('deleteTemplate', [{ name: 'id', wire: 'id', source: 'json', codec: id() }]),
    descriptor('setDefaultTemplate', [{ name: 'id', wire: 'id', source: 'json', codec: id() }]),
  ],
}

/* ---------- 类型增广：ctx.remote.dailyLog 有类型 ---------- */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'dailyLog/listSources': () => Promise<RemoteResult<readonly SourceRecord[]>>
    'dailyLog/addSource': (input: SourceAddInput) => Promise<RemoteResult<SourceRecord>>
    'dailyLog/removeSource': (id: SourceId) => Promise<RemoteResult<boolean>>
    'dailyLog/scanSource': (id: SourceId, range: DateRange) => Promise<RemoteResult<ScanResult>>
    'dailyLog/listWorkspaceCandidates': () => Promise<RemoteResult<readonly ProjectCandidate[]>>
    'dailyLog/discoverSessionProjects': () => Promise<RemoteResult<readonly ProjectCandidate[]>>
    'dailyLog/listReports': () => Promise<RemoteResult<readonly ReportRecord[]>>
    'dailyLog/getReport': (id: ReportId) => Promise<RemoteResult<ReportRecord | undefined>>
    'dailyLog/deleteReport': (id: ReportId) => Promise<RemoteResult<boolean>>
    // outputDir 无缺省形参：必须显式传 undefined（见文件头「参数个数」约束）。
    'dailyLog/exportReport': (id: ReportId, outputDir: string | undefined) => Promise<RemoteResult<string>>
    'dailyLog/listTemplates': () => Promise<RemoteResult<readonly TemplateRecord[]>>
    'dailyLog/getTemplate': (id: TemplateId) => Promise<RemoteResult<TemplateRecord | undefined>>
    'dailyLog/createTemplate': (input: { name: string; content: string }) => Promise<RemoteResult<TemplateRecord>>
    'dailyLog/updateTemplate': (id: TemplateId, patch: { name?: string; content?: string }) => Promise<RemoteResult<TemplateRecord | undefined>>
    'dailyLog/deleteTemplate': (id: TemplateId) => Promise<RemoteResult<boolean>>
    'dailyLog/setDefaultTemplate': (id: TemplateId) => Promise<RemoteResult<boolean>>
  }
  interface TypertRemoteNamespaceMap {
    dailyLog: TypertRemoteNamespace<'dailyLog'>
  }
}

/** 供 UI 使用的窄接口。 */
export interface DailyLogRemote {
  listSources(): Promise<RemoteResult<readonly SourceRecord[]>>
  addSource(input: SourceAddInput): Promise<RemoteResult<SourceRecord>>
  removeSource(id: SourceId): Promise<RemoteResult<boolean>>
  scanSource(id: SourceId, range: DateRange): Promise<RemoteResult<ScanResult>>
  listWorkspaceCandidates(): Promise<RemoteResult<readonly ProjectCandidate[]>>
  discoverSessionProjects(): Promise<RemoteResult<readonly ProjectCandidate[]>>
  listReports(): Promise<RemoteResult<readonly ReportRecord[]>>
  getReport(id: ReportId): Promise<RemoteResult<ReportRecord | undefined>>
  deleteReport(id: ReportId): Promise<RemoteResult<boolean>>
  exportReport(id: ReportId, outputDir: string | undefined): Promise<RemoteResult<string>>
  listTemplates(): Promise<RemoteResult<readonly TemplateRecord[]>>
  getTemplate(id: TemplateId): Promise<RemoteResult<TemplateRecord | undefined>>
  createTemplate(input: { name: string; content: string }): Promise<RemoteResult<TemplateRecord>>
  updateTemplate(id: TemplateId, patch: { name?: string; content?: string }): Promise<RemoteResult<TemplateRecord | undefined>>
  deleteTemplate(id: TemplateId): Promise<RemoteResult<boolean>>
  setDefaultTemplate(id: TemplateId): Promise<RemoteResult<boolean>>
}

/** 挂载 dailyLog 远程命名空间。await 完成后方可调用 dailyLogOf(ctx)。 */
export async function mountDailyLogRemote(ctx: Context): Promise<() => Promise<void>> {
  return ctx.remote.$mount(dailyLogRemoteContribution)
}

/** 取已挂载的 dailyLog 远程命名空间（须在 mountDailyLogRemote 完成后调用）。 */
export function dailyLogOf(ctx: Context): DailyLogRemote {
  return (ctx.remote as ClientRemote & { dailyLog: DailyLogRemote }).dailyLog
}
