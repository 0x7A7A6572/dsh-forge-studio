/**
 * memory 远程通道（client → host，Typert Gateway 直连，不走会话）：
 * host 侧 MemoryService 以 SRC 标记模式暴露 memory/* 端点（见 service.ts）。
 * 本文件手写对应的 client 贡献：ctx.remote.$mount 后即可 ctx.remote.memory.list() 等。
 *
 * 约束（两处必须与 host 一致）：
 * - 端点 method 名 = host 方法名；
 * - 参数 wire 名 = host 方法形参名（query / patch / id / scope / projectPath / archived / input）。
 * 参数 codec 用 strict/loose（client API 层强制），result 用 src-json（透传）。
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
  MemoryAuditEntry, MemoryAuditQuery, MemoryConfig, MemoryConflict, MemoryId, MemoryImportInput,
  MemoryImportResult, MemoryIngestInput, MemoryIngestResult, MemoryPatch, MemoryProjectSummary,
  MemoryQuery, MemoryRawDocument, MemoryRawId, MemoryRawQuery, MemoryRecord, MemorySaveInput,
  MemoryScope, MemoryStats,
} from '../../types.ts'

export const MEMORY_REMOTE_PACKAGE = '@zzerx/dsh-plugin-memory'
const SERVICE = 'memory'
const NAMESPACE = 'memory'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * strict codec（手写，无需 zod；只做形状校验）。
 *
 * 同时给出两代契约字段，兼容新旧 dsh：
 * - `create`：dsh >= 0.1.6-alpha 的 typert 校验要求 strict codec 带 create() 工厂，
 *   边界首次使用时惰性取 schema（HEAD 只读这个字段）；
 * - `schema`：0.1.5-rc.2 及更早直接读 schema.parse。
 * schema 是常量对象，create() 直接复用，无额外开销。
 */
function strict<T>(typeSymbol: string, schema: TypertSchema<T>): TypertCodec {
  return { mode: 'strict', typeSymbol, create: () => schema, schema } as unknown as TypertCodec
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

const stringCodec: TypertCodec = strict<string>('string', {
  parse(value) {
    if (typeof value !== 'string') throw new Error('expected string')
    return value
  },
})

const optionalString: TypertCodec = strict<string | undefined>('string?', {
  parse(value) {
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw new Error('expected string')
    return value
  },
})

const booleanCodec: TypertCodec = strict<boolean>('boolean', {
  parse(value) {
    if (typeof value !== 'boolean') throw new Error('expected boolean')
    return value
  },
})

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

const idParam: InvocationDescriptor['parameters'] = [
  { name: 'id', wire: 'id', source: 'json', codec: stringCodec },
]

/** 原文留档端点：形参名是 rawId（不是 id），wire 名必须逐字一致。 */
const rawIdParam: InvocationDescriptor['parameters'] = [
  { name: 'rawId', wire: 'rawId', source: 'json', codec: stringCodec },
]

const scopeTargetParams: InvocationDescriptor['parameters'] = [
  { name: 'scope', wire: 'scope', source: 'json', codec: stringCodec },
  { name: 'projectPath', wire: 'projectPath', source: 'json', codec: optionalString },
]

export const memoryRemoteContribution: TypertRemoteContribution = {
  package: MEMORY_REMOTE_PACKAGE,
  descriptors: [
    descriptor('list', [{ name: 'query', wire: 'query', source: 'json', codec: loose<MemoryQuery>('MemoryQuery') }]),
    descriptor('getConfig', []),
    descriptor('setConfig', [{ name: 'patch', wire: 'patch', source: 'json', codec: loose<Partial<MemoryConfig>>('MemoryConfigPatch') }]),
  descriptor('getConflicts', []),
    descriptor('stats', []),
    descriptor('projects', []),
    descriptor('exportText', scopeTargetParams),
    descriptor('save', [{ name: 'input', wire: 'input', source: 'json', codec: loose<MemorySaveInput>('MemorySaveInput') }]),
    descriptor('updateMemory', [
      ...idParam,
      { name: 'patch', wire: 'patch', source: 'json', codec: loose<MemoryPatch>('MemoryPatch') },
    ]),
    descriptor('setArchived', [
      ...idParam,
      { name: 'archived', wire: 'archived', source: 'json', codec: booleanCodec },
    ]),
    descriptor('removeMemory', idParam),
    descriptor('reset', scopeTargetParams),
    descriptor('importText', [{ name: 'input', wire: 'input', source: 'json', codec: loose<MemoryImportInput>('MemoryImportInput') }]),
    descriptor('tidy', []),
    descriptor('ingest', [{ name: 'input', wire: 'input', source: 'json', codec: loose<MemoryIngestInput>('MemoryIngestInput') }]),
    descriptor('reingest', rawIdParam),
    descriptor('rawDocuments', [{ name: 'query', wire: 'query', source: 'json', codec: loose<MemoryRawQuery>('MemoryRawQuery') }]),
    descriptor('getRawDocument', rawIdParam),
    descriptor('removeRawDocument', rawIdParam),
    descriptor('audits', [{ name: 'query', wire: 'query', source: 'json', codec: loose<MemoryAuditQuery>('MemoryAuditQuery') }]),
  ],
}

/* ---------- 类型增广：ctx.remote.memory 有类型 ---------- */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'memory/list': (query?: MemoryQuery) => Promise<RemoteResult<readonly MemoryRecord[]>>
    'memory/getConfig': () => Promise<RemoteResult<MemoryConfig>>
    'memory/setConfig': (patch: Partial<MemoryConfig>) => Promise<RemoteResult<MemoryConfig>>
  'memory/getConflicts': () => Promise<RemoteResult<MemoryConflict[]>>
    'memory/stats': () => Promise<RemoteResult<MemoryStats>>
    'memory/projects': () => Promise<RemoteResult<readonly MemoryProjectSummary[]>>
    'memory/exportText': (scope: MemoryScope, projectPath?: string) => Promise<RemoteResult<string>>
    'memory/save': (input: MemorySaveInput) => Promise<RemoteResult<MemoryRecord>>
    'memory/updateMemory': (id: MemoryId, patch: MemoryPatch) => Promise<RemoteResult<MemoryRecord | undefined>>
    'memory/setArchived': (id: MemoryId, archived: boolean) => Promise<RemoteResult<MemoryRecord | undefined>>
    'memory/removeMemory': (id: MemoryId) => Promise<RemoteResult<boolean>>
    'memory/reset': (scope: MemoryScope, projectPath?: string) => Promise<RemoteResult<number>>
    'memory/importText': (input: MemoryImportInput) => Promise<RemoteResult<MemoryImportResult>>
    'memory/tidy': () => Promise<RemoteResult<{ merged: number; removed: number }>>
    'memory/ingest': (input: MemoryIngestInput) => Promise<RemoteResult<MemoryIngestResult>>
    'memory/reingest': (rawId: MemoryRawId) => Promise<RemoteResult<MemoryIngestResult>>
    'memory/rawDocuments': (query?: MemoryRawQuery) => Promise<RemoteResult<readonly MemoryRawDocument[]>>
    'memory/getRawDocument': (id: MemoryRawId) => Promise<RemoteResult<MemoryRawDocument | undefined>>
    'memory/removeRawDocument': (id: MemoryRawId) => Promise<RemoteResult<boolean>>
    'memory/audits': (query?: MemoryAuditQuery) => Promise<RemoteResult<readonly MemoryAuditEntry[]>>
  }
  interface TypertRemoteNamespaceMap {
    memory: TypertRemoteNamespace<'memory'>
  }
}

/** 供 UI 使用的窄接口。 */
export interface MemoryRemote {
  list(query?: MemoryQuery): Promise<RemoteResult<readonly MemoryRecord[]>>
  getConfig(): Promise<RemoteResult<MemoryConfig>>
  setConfig(patch: Partial<MemoryConfig>): Promise<RemoteResult<MemoryConfig>>
  /** 与其它记忆插件的重名冲突（空数组 = 无冲突）。 */
  getConflicts(): Promise<RemoteResult<MemoryConflict[]>>
  stats(): Promise<RemoteResult<MemoryStats>>
  projects(): Promise<RemoteResult<readonly MemoryProjectSummary[]>>
  exportText(scope: MemoryScope, projectPath?: string): Promise<RemoteResult<string>>
  save(input: MemorySaveInput): Promise<RemoteResult<MemoryRecord>>
  updateMemory(id: MemoryId, patch: MemoryPatch): Promise<RemoteResult<MemoryRecord | undefined>>
  setArchived(id: MemoryId, archived: boolean): Promise<RemoteResult<MemoryRecord | undefined>>
  removeMemory(id: MemoryId): Promise<RemoteResult<boolean>>
  reset(scope: MemoryScope, projectPath?: string): Promise<RemoteResult<number>>
  importText(input: MemoryImportInput): Promise<RemoteResult<MemoryImportResult>>
  tidy(): Promise<RemoteResult<{ merged: number; removed: number }>>
  /** 摄取管线：原文留档 + 解析成条目（面板导入走 importText，此处给原文/审计面板用）。 */
  ingest(input: MemoryIngestInput): Promise<RemoteResult<MemoryIngestResult>>
  reingest(rawId: MemoryRawId): Promise<RemoteResult<MemoryIngestResult>>
  rawDocuments(query?: MemoryRawQuery): Promise<RemoteResult<readonly MemoryRawDocument[]>>
  getRawDocument(id: MemoryRawId): Promise<RemoteResult<MemoryRawDocument | undefined>>
  removeRawDocument(id: MemoryRawId): Promise<RemoteResult<boolean>>
  audits(query?: MemoryAuditQuery): Promise<RemoteResult<readonly MemoryAuditEntry[]>>
}

/** 挂载 memory 远程命名空间。await 完成后方可调用 memoryOf(ctx)。 */
export async function mountMemoryRemote(ctx: Context): Promise<() => Promise<void>> {
  return ctx.remote.$mount(memoryRemoteContribution)
}

/** 取已挂载的 memory 远程命名空间（须在 mountMemoryRemote 完成后调用）。 */
export function memoryOf(ctx: Context): MemoryRemote {
  return (ctx.remote as ClientRemote & { memory: MemoryRemote }).memory
}
