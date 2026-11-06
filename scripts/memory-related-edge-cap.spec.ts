/**
 * related 自动边的桶封顶门禁：封顶必须只削 related，不殃及 about / mentions。
 *
 * 背景：同步自动边时，共享同一实体的记忆两两连 related —— 一个实体挂 n 条记忆就是
 * n(n-1)/2 条边，每条边落盘都是一个独立 JSON 文件；无处不在的实体（如助手自己的名字）
 * 能把边文件堆到数万。封顶后超限桶整桶不连，小桶语义（两两全连、weight = 共享实体数）不变。
 */
import { describe, expect, it } from 'vitest'
import { MEMORY_RELATED_BUCKET_CAP, MemoryService, edgeIdOf } from '../packages/plugin-memory/src/service.ts'
import { SAFE_KEY_RE, edgeKey } from '../packages/plugin-memory/src/storage-key.ts'
import type { MemoryEdge, MemoryEntity, MemoryRecord } from '../packages/plugin-memory/src/types.ts'

/** 假表：照抄真实后端的键校验（同 memory-bundle-import.spec.ts 的搭法）。 */
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

/** 绕开 constructor 直接打表（同 memory-bundle-import.spec.ts），被测的是 syncAutoEdges。 */
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

function entity(id: string, name: string): MemoryEntity {
  return {
    id: id as MemoryEntity['id'],
    name,
    kind: 'concept',
    aliases: [],
    summary: '',
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function record(id: string, title: string, content = ''): MemoryRecord {
  return {
    id: id as MemoryRecord['id'],
    kind: 'fact',
    scope: 'project',
    projectPath: 'F:\\codes\\dsh-forge-studio',
    title,
    content,
    importance: 3,
    tags: [],
    summary: '',
    aliases: [],
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    source: 'test',
  }
}

async function syncAutoEdges(svc: MemoryService): Promise<{ added: number; removed: number }> {
  return (svc as unknown as { syncAutoEdges(): Promise<{ added: number; removed: number }> }).syncAutoEdges()
}

function edgesOf(tables: Tables): MemoryEdge[] {
  return Array.from(tables.edges.entries(), ([, edge]) => edge as MemoryEdge)
}

function edgesOfRelation(edges: readonly MemoryEdge[], relation: MemoryEdge['relation']): MemoryEdge[] {
  return edges.filter((edge) => edge.relation === relation)
}

/** 两条记忆的 related 边 id（related 对称，端点顺序无关）。 */
function relatedId(a: string, b: string): string {
  return edgeIdOf({ kind: 'memory', id: a }, { kind: 'memory', id: b }, 'related')
}

describe('syncAutoEdges —— related 桶封顶', () => {
  it('恰好等于上限：小桶语义不变，两两全连', async () => {
    const { svc, tables } = makeService()
    const cap = MEMORY_RELATED_BUCKET_CAP
    await tables.entities.put('e1', entity('e1', '小桶实体'))
    const ids: string[] = []
    for (let i = 0; i < cap; i += 1) {
      const id = `mem-small-${String(i).padStart(2, '0')}`
      ids.push(id)
      await tables.memories.put(id, record(id, `第 ${i} 条：小桶实体`))
    }
    await syncAutoEdges(svc)
    const related = edgesOfRelation(edgesOf(tables), 'related')
    expect(related).toHaveLength((cap * (cap - 1)) / 2)
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        expect(related.some((edge) => edge.id === relatedId(ids[i]!, ids[j]!))).toBe(true)
      }
    }
  })

  it('超过上限的桶整桶不连 related，about 边不受影响', async () => {
    const { svc, tables } = makeService()
    await tables.entities.put('e1', entity('e1', '无处不在'))
    for (let i = 0; i < MEMORY_RELATED_BUCKET_CAP + 1; i += 1) {
      const id = `mem-big-${String(i).padStart(2, '0')}`
      await tables.memories.put(id, record(id, `第 ${i} 条：无处不在`))
    }
    await syncAutoEdges(svc)
    const edges = edgesOf(tables)
    expect(edgesOfRelation(edges, 'related')).toHaveLength(0)
    expect(edgesOfRelation(edges, 'about')).toHaveLength(MEMORY_RELATED_BUCKET_CAP + 1)
  })

  it('少量记忆共享小实体：related 仍是全部两两组合，weight = 共享实体数', async () => {
    const { svc, tables } = makeService()
    await tables.entities.put('ea', entity('ea', '实体甲'))
    await tables.entities.put('eb', entity('eb', '实体乙'))
    const m1 = 'mem-pair-1'
    const m2 = 'mem-pair-2'
    const m3 = 'mem-pair-3'
    // m1 / m2 同时命中两个实体，m3 只命中实体甲。
    await tables.memories.put(m1, record(m1, '实体甲与实体乙'))
    await tables.memories.put(m2, record(m2, '实体甲和实体乙'))
    await tables.memories.put(m3, record(m3, '只提实体甲'))
    await syncAutoEdges(svc)
    const related = edgesOfRelation(edgesOf(tables), 'related')
    expect(related.map((edge) => edge.id).sort()).toEqual([
      relatedId(m1, m2),
      relatedId(m1, m3),
      relatedId(m2, m3),
    ].sort())
    const weightOf = (a: string, b: string): number =>
      related.find((edge) => edge.id === relatedId(a, b))!.weight
    expect(weightOf(m1, m2)).toBe(2)
    expect(weightOf(m1, m3)).toBe(1)
    expect(weightOf(m2, m3)).toBe(1)
  })

  it('跨桶 weight 抹除：共享超限实体的对，weight 只按参与连边的实体计', async () => {
    const { svc, tables } = makeService()
    const cap = MEMORY_RELATED_BUCKET_CAP
    await tables.entities.put('ea', entity('ea', '实体甲'))
    await tables.entities.put('eb', entity('eb', '无处不在'))
    const m1 = 'mem-cross-1'
    const m2 = 'mem-cross-2'
    // m1 / m2 同时命中两个实体；再补 CAP-1 条只命中「无处不在」，把 eb 顶成超限桶。
    await tables.memories.put(m1, record(m1, '实体甲与无处不在'))
    await tables.memories.put(m2, record(m2, '实体甲和无处不在'))
    for (let i = 3; i < cap + 2; i += 1) {
      const id = `mem-cross-${i}`
      await tables.memories.put(id, record(id, `第 ${i} 条：无处不在`))
    }
    await syncAutoEdges(svc)
    const related = edgesOfRelation(edgesOf(tables), 'related')
    const pair = related.find((edge) => edge.id === relatedId(m1, m2))
    expect(pair).toBeDefined()
    expect(pair!.weight).toBe(1)
  })

  it('存量清理：超限桶内的一对，历史 auto related 边被同步删除', async () => {
    const { svc, tables } = makeService()
    await tables.entities.put('eb', entity('eb', '无处不在'))
    const staleId = relatedId('mem-old-1', 'mem-old-2')
    await tables.edges.put(edgeKey(staleId), {
      id: staleId,
      from: { kind: 'memory', id: 'mem-old-1' },
      to: { kind: 'memory', id: 'mem-old-2' },
      relation: 'related',
      note: '',
      weight: 1,
      origin: 'auto',
      createdAt: 1,
      updatedAt: 1,
    } satisfies MemoryEdge)
    for (let i = 1; i <= MEMORY_RELATED_BUCKET_CAP + 1; i += 1) {
      const id = `mem-old-${i}`
      await tables.memories.put(id, record(id, `第 ${i} 条：无处不在`))
    }
    await syncAutoEdges(svc)
    expect(tables.edges.get(edgeKey(staleId))).toBeUndefined()
  })
})
