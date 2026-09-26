/**
 * 备份导入的落盘键门禁：导入要么整份进去，要么别在「写了一半」的地方炸。
 *
 * 背景（实测故障）：per-record 布局把键当文件路径的一段，只接受 `/^[a-zA-Z0-9_-]+$/`，
 * 不匹配时 put / delete 直接抛错。而边 id 是 `memory:<id>|about|entity:<id>` 这种逻辑 id
 * —— importBundle 曾经拿它当键直接写，于是整次导入在写完 memories / entities 之后抛错：
 * 用户看到的是「导入报错」，但记忆和实体已经进来了，边一条没落（关联图整个空掉）。
 * 更早的假表是纯 Map、从不校验键，所以这个 bug 在整套绿灯用例下活了很久。
 * （`link` / 自动边那几条路当时都过了 `edgeKey`，唯独批量导入漏了 —— 于是只有导入出事。）
 *
 * 这里的假表照抄真实后端的键校验，钉住四件事：
 * - 备份里的边只能落在路径安全的键上，且能按逻辑 id 读回来；
 * - 整次导入不抛错（抛错 = 用户拿到半份数据 + 一个看不懂的报错）；
 * - merge 不用旧备份盖掉库里更新的边；
 * - replace 清空后边照常回来（清空走的也是安全键）。
 */
import { describe, expect, it } from 'vitest'
import { MemoryService } from '../packages/plugin-memory/src/service.ts'
import { SAFE_KEY_RE, edgeKey } from '../packages/plugin-memory/src/storage-key.ts'
import { MEMORY_BUNDLE_SCHEMA, MEMORY_BUNDLE_VERSION } from '../packages/plugin-memory/src/types.ts'
import type { MemoryEdge, MemoryEntity, MemoryRecord } from '../packages/plugin-memory/src/types.ts'

const MEMORY_ID = '14cf3bff-3e79-49b2-a4f4-19c39425639e'
const OTHER_ID = '8b1d0dd8-2f0e-4c0a-9ad4-5f1a2c3d4e5f'
const ENTITY_ID = '077382d0-67d7-456f-97ba-5f908f6932e4'

/** 假表：只实现 service 用到的四个操作，但**照抄真实后端的键校验**（报错文案也对齐生产）。 */
function fakeTable() {
  const rows = new Map<string, unknown>()
  const assertSafe = (key: string): void => {
    if (!SAFE_KEY_RE.test(key)) {
      throw new Error(`unit 'memory': per-record key '${key}' is not path-safe (must match ${SAFE_KEY_RE})`)
    }
  }
  return {
    keys: (): string[] => [...rows.keys()],
    get: (key: string): unknown => {
      assertSafe(key)
      return rows.get(key)
    },
    entries: (): IterableIterator<[string, unknown]> => rows.entries(),
    put: async (key: string, value: unknown): Promise<void> => {
      assertSafe(key)
      rows.set(key, value)
    },
    delete: async (key: string): Promise<void> => {
      assertSafe(key)
      rows.delete(key)
    },
  }
}

type Tables = ReturnType<typeof makeTables>

function makeTables() {
  return {
    memories: fakeTable(),
    raw_documents: fakeTable(),
    audits: fakeTable(),
    entities: fakeTable(),
    edges: fakeTable(),
  }
}

/**
 * 直接给实例字段打表，不走 constructor：constructor 里只有 `super(ctx, 'memory')` 与五次
 * `domain.table(...)`，而 scripts/ 层的 spec 碰不到包内 node_modules 的 cordis（裸依赖只在
 * 包源码里解析），所以这里绕开它 —— 被测的是 importBundle 的落盘键，不是注册流程。
 */
function makeService(): { svc: MemoryService; tables: Tables } {
  const tables = makeTables()
  const svc = Object.create(MemoryService.prototype) as MemoryService
  Object.assign(svc as unknown as Record<string, unknown>, {
    memories: tables.memories,
    rawDocs: tables.raw_documents,
    auditRows: tables.audits,
    entities: tables.entities,
    edges: tables.edges,
    config: { domain: { table: (name: keyof Tables) => tables[name] } },
    conflicts: [],
  })
  return { svc, tables }
}

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: MEMORY_ID as MemoryRecord['id'],
    kind: 'fact',
    scope: 'project',
    projectPath: 'F:\\codes\\dsh-forge-studio',
    title: 'dsh-forge-studio 记忆图谱',
    content: '实体与边落在同一张存储域里。',
    importance: 3,
    tags: ['memory'],
    summary: '',
    aliases: [],
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    source: 'import',
    ...overrides,
  }
}

function entity(overrides: Partial<MemoryEntity> = {}): MemoryEntity {
  return {
    id: ENTITY_ID as MemoryEntity['id'],
    name: 'dsh-forge-studio',
    kind: 'project',
    aliases: [],
    summary: '',
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** 一条「记忆 → 实体」的显式边；id 与 edgeIdOf 的确定性结果一致（about 不是对称关系）。 */
function edgeOf(relation: 'about' | 'mentions', updatedAt: number, note = ''): MemoryEdge {
  return {
    id: `memory:${MEMORY_ID}|${relation}|entity:${ENTITY_ID}`,
    from: { kind: 'memory', id: MEMORY_ID },
    to: { kind: 'entity', id: ENTITY_ID },
    relation,
    note,
    weight: 1,
    origin: 'user',
    createdAt: 1,
    updatedAt,
  }
}

function bundleWith(edges: readonly MemoryEdge[]): unknown {
  return {
    schema: MEMORY_BUNDLE_SCHEMA,
    version: MEMORY_BUNDLE_VERSION,
    exportedAt: 1,
    records: [record()],
    entities: [entity()],
    edges,
  }
}

describe('importBundle —— 边不能丢在报错背后', () => {
  it('备份里的边落在路径安全的键上，并能按逻辑 id 读回来', async () => {
    const { svc, tables } = makeService()
    const edge = edgeOf('about', 10)
    await svc.importBundle({ bundle: bundleWith([edge]), mode: 'merge' })
    // 赤裸的逻辑 id 本身就非法 —— 编码是它唯一能落盘的方式。
    expect(SAFE_KEY_RE.test(edge.id)).toBe(false)
    expect(tables.edges.get(edgeKey(edge.id))).toEqual(edge)
  })

  it('整次导入不抛错：不再出现「报错了，可记忆和实体已经进来了」', async () => {
    const { svc, tables } = makeService()
    const result = await svc.importBundle({
      bundle: bundleWith([edgeOf('about', 10), edgeOf('mentions', 11)]),
      mode: 'merge',
    })
    expect(result).toEqual({ added: 1, merged: 0, removed: 0 })
    expect(tables.edges.keys()).toEqual(expect.arrayContaining([
      edgeKey(edgeOf('about', 10).id),
      edgeKey(edgeOf('mentions', 11).id),
    ]))
  })

  it('merge 不用旧备份盖掉库里更新的边', async () => {
    const { svc, tables } = makeService()
    const live = edgeOf('about', 20, '库里更新的备注')
    await tables.edges.put(edgeKey(live.id), live)
    await svc.importBundle({ bundle: bundleWith([edgeOf('about', 10, '备份里的旧备注')]), mode: 'merge' })
    expect(tables.edges.get(edgeKey(live.id))).toEqual(live)
  })

  it('replace 清空后边照常回来（清空走的也是安全键）', async () => {
    const { svc, tables } = makeService()
    const stale = edgeOf('mentions', 5)
    await tables.memories.put(OTHER_ID, record({ id: OTHER_ID as MemoryRecord['id'] }))
    await tables.edges.put(edgeKey(stale.id), stale)
    const result = await svc.importBundle({ bundle: bundleWith([edgeOf('about', 10)]), mode: 'replace' })
    expect(result.removed).toBe(1)
    expect(tables.edges.keys()).toEqual([edgeKey(edgeOf('about', 10).id)])
  })
})
