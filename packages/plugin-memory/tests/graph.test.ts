/**
 * wiki 图层（实体 / 边关联）行为测试。
 *
 * 不变量：
 * - 实体按名称 / 别名合并，别名命中的写入不夺走规范名（redirect 语义）；
 * - 记忆提到实体就自动连边：标题或标签命中 = about，只在正文命中 = mentions；
 * - 共享同一实体的两条记忆自动连 related，权重 = 共享实体数；
 * - 边 id 确定性 → 重复连只更新备注，对称关系两个方向是同一条；
 * - 删除记忆 / 实体不留悬空边；rebuildEdges 幂等（自动边永不漂移）。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  MemoryService, edgeIdOf, entityNameKey, mergeAliases, nodeKey, parseNodeKey,
} from '../src/service.ts'
import { MEMORY_TOOL_NAMES, describeRecord, installMemoryTools } from '../src/agent/tools.ts'
import { memoryEdgeSchema, memoryEntitySchema, memoryRecordSchema } from '../src/domain.ts'
import type { MemoryEdge, MemoryEntity } from '../src/types.ts'
import { SAFE_KEY_RE } from '../src/storage-key.ts'

/**
 * 每张表一个假的 Map 后端（service 只用到 get / entries / put / delete）。
 *
 * 写路径**照抄真实后端的键校验**（键会变成文件路径的一段，只接受 `[a-zA-Z0-9_-]+`，
 * 不匹配时 putRecord / deleteRecord 抛错）。此前这里是纯 Map、从不校验键，于是
 * 「边 id `memory:<id>|about|entity:<id>` 带 `|` 与 `:`」这个真实运行时**每一次连边写入都失败**
 * 的 bug，在整套绿灯用例下藏了很久 —— 键的问题必须在写的时候暴露。
 */
function fakeTable(unit = 'memory') {
  const rows = new Map<string, unknown>()
  const assertSafe = (key: string): void => {
    if (!SAFE_KEY_RE.test(key)) {
      throw new Error(`unit '${unit}': per-record key '${key}' is not path-safe (must match ${SAFE_KEY_RE})`)
    }
  }
  return {
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    put: async (key: string, value: unknown) => { assertSafe(key); rows.set(key, value) },
    delete: async (key: string) => { assertSafe(key); rows.delete(key) },
  }
}

function makeService() {
  const tables = {
    memories: fakeTable('memories'),
    raw_documents: fakeTable('raw_documents'),
    audits: fakeTable('audits'),
    entities: fakeTable('entities'),
    edges: fakeTable('edges'),
  }
  const domain = { table: (name: keyof typeof tables) => tables[name] }
  const ctx = new Context()
  return new MemoryService(ctx, { domain } as never)
}

/** 只看连到实体那一侧的边（自动边 + 显式边都会出现在这里）。 */
async function entityEdges(svc: MemoryService, id: string): Promise<MemoryEdge[]> {
  const edges = await svc.listEdges({ node: { kind: 'memory', id } })
  return edges.filter((edge) => edge.to.kind === 'entity')
}

function byName(entities: readonly MemoryEntity[], name: string): MemoryEntity | undefined {
  return entities.find((entity) => entity.name === name)
}

/* ---------------- 纯函数：端点与 id ---------------- */

describe('端点与边 id', () => {
  it('端点键可往返，非法键返回 undefined', () => {
    const ref = { kind: 'memory', id: 'abc' } as const
    expect(nodeKey(ref)).toBe('memory:abc')
    expect(parseNodeKey('memory:abc')).toEqual(ref)
    expect(parseNodeKey('entity:x:y')).toEqual({ kind: 'entity', id: 'x:y' })
    expect(parseNodeKey('nope:x')).toBeUndefined()
    expect(parseNodeKey('memory')).toBeUndefined()
  })

  it('对称关系的 id 与端点顺序无关，方向性关系有关', () => {
    const a = { kind: 'memory', id: 'a' } as const
    const b = { kind: 'memory', id: 'b' } as const
    expect(edgeIdOf(a, b, 'related')).toBe(edgeIdOf(b, a, 'related'))
    expect(edgeIdOf(a, b, 'supersedes')).not.toBe(edgeIdOf(b, a, 'supersedes'))
  })

  it('mergeAliases 剔除与本体标题相同的写法，并去重', () => {
    expect(mergeAliases({ title: '标题', aliases: ['别名', '标题'] }, '另一个', ['别名', ' ']))
      .toEqual(['别名', '另一个'])
    expect(entityNameKey('  记忆   插件 ')).toBe('记忆 插件')
  })
})

/* ---------------- 实体 ---------------- */

describe('实体', () => {
  it('同名合并、别名命中合并，别名不夺走规范名', async () => {
    const svc = makeService()
    const first = await svc.upsertEntity({ name: '记忆插件', kind: 'tool', summary: '插件本体' })
    const second = await svc.upsertEntity({ name: ' 记忆插件 ', aliases: ['memory 插件'] })
    expect(second.id).toBe(first.id)
    expect(second.kind).toBe('tool')
    expect(second.summary).toBe('插件本体')
    expect(second.aliases).toEqual(['memory 插件'])

    const third = await svc.upsertEntity({ name: 'memory 插件', summary: '别名命中也并入' })
    expect(third.id).toBe(first.id)
    expect(third.name).toBe('记忆插件')
    expect(third.summary).toBe('别名命中也并入')
    expect(await svc.listEntities({})).toHaveLength(1)
  })

  it('带 id 才是改名：旧名落成别名', async () => {
    const svc = makeService()
    const entity = await svc.upsertEntity({ name: '旧名', aliases: [] })
    const renamed = await svc.upsertEntity({ id: entity.id, name: '新名' })
    expect(renamed.name).toBe('新名')
    expect(renamed.aliases).toContain('旧名')
  })

  it('按关键字 / 类别过滤，归档默认不出现', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '甲工具', kind: 'tool', summary: '写代码' })
    const archived = await svc.upsertEntity({ name: '乙概念', kind: 'concept', archived: true })
    expect((await svc.listEntities({ kind: 'tool' })).map((item) => item.name)).toEqual(['甲工具'])
    expect(await svc.listEntities({})).toHaveLength(1)
    expect(await svc.listEntities({ includeArchived: true })).toHaveLength(2)
    expect((await svc.listEntities({ keyword: '写代码' })).map((item) => item.name)).toEqual(['甲工具'])
    expect(archived.archived).toBe(true)
  })
})

/* ---------------- 自动边 ---------------- */

describe('自动边', () => {
  it('标题或标签命中 = about，只在正文命中 = mentions', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '插件市场', kind: 'concept' })
    const inTitle = await svc.save({ title: '插件市场收录', content: '走 npm 预构建安装。' })
    const inBody = await svc.save({ title: '收录流程', content: '插件市场 分两步：扫描、再勾选。' })
    const inTags = await svc.save({ title: '标签命中', content: '正文不出现那四个字。', tags: ['插件市场'] })
    expect((await entityEdges(svc, inTitle.id)).map((edge) => edge.relation)).toEqual(['about'])
    expect((await entityEdges(svc, inBody.id)).map((edge) => edge.relation)).toEqual(['mentions'])
    expect((await entityEdges(svc, inTags.id)).map((edge) => edge.relation)).toEqual(['about'])
  })

  it('别名命中实体的也算提及', async () => {
    const svc = makeService()
    const entity = await svc.upsertEntity({ name: '记忆库', aliases: ['memory store'] })
    const record = await svc.save({ title: '存哪儿', content: '正文里写的是 memory store 这个说法。' })
    const edges = await entityEdges(svc, record.id)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.relation).toBe('mentions')
    expect(edges[0]!.to.id).toBe(entity.id)
  })

  it('短名（1 个字）不参与自动提及', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '我' })
    const record = await svc.save({ title: '自言自语', content: '我我我。' })
    expect(await entityEdges(svc, record.id)).toHaveLength(0)
  })

  it('共享实体的两条记忆自动连 related，权重 = 共享实体数', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: 'dsh 插件' })
    await svc.upsertEntity({ name: '记忆库' })
    const first = await svc.save({ title: '甲条', content: '第一条点名了 dsh 插件，也说到了 记忆库。' })
    await svc.save({ title: '乙条', content: '另一段完全不同的句子，同样提到 dsh 插件 与 记忆库。' })
    const related = (await svc.listEdges({ node: { kind: 'memory', id: first.id } }))
      .filter((edge) => edge.relation === 'related')
    expect(related).toHaveLength(1)
    expect(related[0]!.weight).toBe(2)
    expect(related[0]!.origin).toBe('auto')
  })

  it('改标题会让自动边跟着变（about → mentions 之外也不再残留旧边）', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '插件市场' })
    const record = await svc.save({ title: '插件市场收录', content: '正文里也提 插件市场。' })
    expect((await entityEdges(svc, record.id)).map((edge) => edge.relation)).toEqual(['about'])
    await svc.updateMemory(record.id, { title: '收录流程' })
    expect((await entityEdges(svc, record.id)).map((edge) => edge.relation)).toEqual(['mentions'])
  })

  it('归档后自动边被清掉', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '归档主题' })
    const record = await svc.save({ title: '待归档', content: '归档主题 出现在正文。' })
    expect(await entityEdges(svc, record.id)).toHaveLength(1)
    await svc.setArchived(record.id, true)
    expect(await svc.listEdges({ node: { kind: 'memory', id: record.id } })).toHaveLength(0)
  })

  it('rebuildEdges 幂等：重跑不再新增也不再清理', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '共同主题' })
    await svc.save({ title: '甲条', content: '共同主题 第一次出现在这里。' })
    await svc.save({ title: '乙条', content: '共同主题 第二次出现在那里。' })
    expect(await svc.rebuildEdges()).toEqual({ added: 0, removed: 0 })
    expect(await svc.rebuildEdges()).toEqual({ added: 0, removed: 0 })
  })

  it('清掉实体名对应的文本后，重算会回收那条自动边', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '临时主题' })
    const record = await svc.save({ title: '含临时主题的标题', content: '正文。' })
    expect(await entityEdges(svc, record.id)).toHaveLength(1)
    // 改名后标题里不再出现实体名 → 自动边应被回收（weight 变化 / 差集删除）。
    await svc.updateMemory(record.id, { title: '改过的标题' })
    expect(await entityEdges(svc, record.id)).toHaveLength(0)
    expect(await svc.listEdges({ node: { kind: 'entity', id: (await svc.listEntities({}))[0]!.id } })).toHaveLength(0)
  })
})

/* ---------------- 显式边 ---------------- */

describe('显式边', () => {
  it('save 的 entities：命中复用、未命中新建，来源是 agent', async () => {
    const svc = makeService()
    const existing = await svc.upsertEntity({ name: '便签插件', kind: 'tool' })
    const record = await svc.save({
      title: '便签插件的定位',
      content: '只做速记，不做记忆。',
      entities: ['便签插件', '全新实体'],
    })
    const edges = await entityEdges(svc, record.id)
    expect(edges).toHaveLength(2)
    expect(edges.every((edge) => edge.relation === 'about')).toBe(true)
    expect(edges.every((edge) => edge.origin === 'agent')).toBe(true)
    const entities = await svc.listEntities({})
    expect(entities).toHaveLength(2)
    expect(entities.some((entity) => entity.id === existing.id)).toBe(true)
  })

  it('连边幂等；对称关系两个方向是同一条，重复连只更新备注', async () => {
    const svc = makeService()
    const a = await svc.save({ title: '甲条', content: '第一条正文。' })
    const b = await svc.save({ title: '乙条', content: '第二条正文。' })
    await svc.link({
      from: { kind: 'memory', id: a.id }, to: { kind: 'memory', id: b.id },
      relation: 'related', note: '同主题', origin: 'agent',
    })
    await svc.link({
      from: { kind: 'memory', id: b.id }, to: { kind: 'memory', id: a.id },
      relation: 'related', note: '更新备注',
    })
    const edges = await svc.listEdges({ node: { kind: 'memory', id: a.id } })
    expect(edges).toHaveLength(1)
    expect(edges[0]!.note).toBe('更新备注')
    expect(edges[0]!.origin).toBe('agent')
  })

  it('端点不存在 / 自连会报错，unlink 返回是否真的删掉', async () => {
    const svc = makeService()
    const a = await svc.save({ title: '甲条', content: '第一条正文。' })
    await expect(svc.link({
      from: { kind: 'memory', id: a.id },
      to: { kind: 'memory', id: 'nope' },
      relation: 'related',
    })).rejects.toThrow('memory not found')
    await expect(svc.link({
      from: { kind: 'memory', id: a.id }, to: { kind: 'memory', id: a.id }, relation: 'related',
    })).rejects.toThrow('itself')
    expect(await svc.unlink('not-an-edge')).toBe(false)
  })

  it('默认关系：记忆 → 实体 = about，记忆 → 记忆 = related', async () => {
    const svc = makeService()
    const entity = await svc.upsertEntity({ name: '默认关系' })
    const a = await svc.save({ title: '甲条', content: '第一条正文。' })
    const b = await svc.save({ title: '乙条', content: '第二条正文。' })
    const toEntity = await svc.link({ from: { kind: 'memory', id: a.id }, to: { kind: 'entity', id: entity.id } })
    expect(toEntity.relation).toBe('about')
    const toMemory = await svc.link({ from: { kind: 'memory', id: a.id }, to: { kind: 'memory', id: b.id } })
    expect(toMemory.relation).toBe('related')
  })

  it('手工边不会被自动重算覆盖或清理', async () => {
    const svc = makeService()
    const entity = await svc.upsertEntity({ name: '手工主题' })
    const a = await svc.save({ title: '甲条', content: '正文里没有那四个字。' })
    await svc.link({
      from: { kind: 'memory', id: a.id }, to: { kind: 'entity', id: entity.id },
      relation: 'about', note: '人手连的', origin: 'user',
    })
    expect(await svc.rebuildEdges()).toEqual({ added: 0, removed: 0 })
    const edges = await entityEdges(svc, a.id)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.origin).toBe('user')
    expect(edges[0]!.note).toBe('人手连的')
  })

  it('列表按 node / relation / origin 过滤', async () => {
    const svc = makeService()
    const entity = await svc.upsertEntity({ name: '过滤主题' })
    const a = await svc.save({ title: '过滤主题的记忆', content: '正文。' })
    expect((await svc.listEdges({ relation: 'about' })).length).toBe(1)
    expect((await svc.listEdges({ relation: 'mentions' })).length).toBe(0)
    expect((await svc.listEdges({ origin: 'auto' })).length).toBe(1)
    expect((await svc.listEdges({ origin: 'user' })).length).toBe(0)
    expect((await svc.listEdges({ node: { kind: 'entity', id: entity.id } })).length).toBe(1)
    expect((await svc.listEdges({ node: { kind: 'memory', id: a.id } })).length).toBe(1)
  })
})

/* ---------------- 清理与视图 ---------------- */

describe('清理与关联视图', () => {
  it('删记忆、删实体都不留悬空边', async () => {
    const svc = makeService()
    const entity = await svc.upsertEntity({ name: '共享主题' })
    // 正文必须真的不一样：阈值降到 0.7 后，「只差一个字」的两条会被语义重叠合并，
    // 那样就不是「两条记忆共享一个实体」了（这个测试要的是后者）。
    const a = await svc.save({ title: '甲条', content: '甲条记录：共享主题 在这次讨论里出现了，讲的是甲方案。' })
    const b = await svc.save({ title: '乙条', content: '乙条记录：另一件事也提到了 共享主题，但说的是乙方案，措辞不一样。' })
    expect((await svc.listEdges({})).length).toBe(3)
    await svc.removeMemory(b.id)
    const left = await svc.listEdges({ node: { kind: 'memory', id: a.id } })
    expect(left).toHaveLength(1)
    expect(left[0]!.relation).toBe('mentions')
    expect(left[0]!.to.id).toBe(entity.id)
    await svc.removeEntity(entity.id)
    expect(await svc.listEdges({})).toHaveLength(0)
  })

  it('reset 清掉该作用域的记忆与它们的边', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '重置主题' })
    await svc.save({ title: '全局条', content: '重置主题 在全局。' })
    await svc.save({ title: '项目条', content: '重置主题 在项目。', scope: 'project', projectPath: 'D:/demo' })
    expect((await svc.listEdges({})).length).toBeGreaterThan(0)
    await svc.reset('global')
    expect(await svc.list({ scope: 'global' })).toHaveLength(0)
    // 全局那条连同它的边一起没了，只剩项目记忆自己的提及边。
    const left = await svc.listEdges({})
    expect(left).toHaveLength(1)
    expect(left[0]!.relation).toBe('mentions')
  })

  it('neighborhood 解析另一端节点（记忆 + 实体）并按边对齐', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '关联主题' })
    const a = await svc.save({ title: '甲条', content: '这条讲 关联主题 的背景。' })
    const b = await svc.save({ title: '乙条', content: '完全不同的一句，也说了 关联主题 这件事，但措辞差别很大。' })
    const view = await svc.neighborhood(a.id)
    expect(view).toBeDefined()
    expect(view!.memory.id).toBe(a.id)
    expect(view!.edges.length).toBe(view!.related.length)
    const labels = view!.related.map((item) => item.node.label).sort((left, right) => left.localeCompare(right, 'zh'))
    expect(labels).toEqual(['关联主题', '乙条'])
    expect(view!.related.every((item) => view!.edges.some((edge) => edge.id === item.edgeId))).toBe(true)
    expect(await svc.neighborhood('missing' as never)).toBeUndefined()
  })

  it('stats 计入实体与边；关键字能搜到摘要与别名', async () => {
    const svc = makeService()
    await svc.upsertEntity({ name: '统计主题' })
    await svc.save({
      title: '统计条',
      content: '正文不提那个词。',
      summary: '一行摘要里有暗号',
      aliases: ['统计条目别名'],
    })
    const stats = await svc.stats()
    expect(stats.entities).toBe(1)
    expect(stats.edges).toBe(0)
    expect((await svc.list({ keyword: '暗号' })).map((record) => record.title)).toEqual(['统计条'])
    expect((await svc.list({ keyword: '统计条目别名' })).map((record) => record.title)).toEqual(['统计条'])
  })
})

/* ---------------- 工具 ---------------- */

describe('工具注册', () => {
  it('注册全部 memory_* 工具（含 memory_entity / memory_link）', async () => {
    const svc = makeService()
    const registered: string[] = []
    const fake = {
      tools: { get: () => undefined, register: (definition: { name: string }) => { registered.push(definition.name) } },
      memory: svc,
      logger: { warn: () => {} },
      effect: () => {},
    }
    installMemoryTools(fake as never, {})
    await new Promise((resolve) => { setTimeout(resolve, 5) })
    expect(registered.slice().sort()).toEqual([...MEMORY_TOOL_NAMES].slice().sort())
    expect(MEMORY_TOOL_NAMES).toContain('memory_entity')
    expect(MEMORY_TOOL_NAMES).toContain('memory_link')
  })

  it('工具视图带摘要与别名', () => {
    const view = describeRecord({
      id: 'm1' as never,
      kind: 'fact',
      scope: 'global',
      projectPath: '',
      title: '标题',
      content: '正文',
      summary: '摘要',
      aliases: ['别名'],
      importance: 3,
      tags: [],
      pinned: false,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      source: 'agent',
    })
    expect(view.summary).toBe('摘要')
    expect(view.aliases).toEqual(['别名'])
  })
})
/* ---------------- 存储边界（zod 会静默丢掉未声明的字段） ---------------- */

describe('存储边界', () => {
  it('记录的新字段能穿过 zod 边界（summary / aliases）', () => {
    const parsed = memoryRecordSchema.parse({
      id: 'm1',
      title: '标题',
      content: '正文',
      summary: '摘要',
      aliases: ['别名'],
      createdAt: 1,
      updatedAt: 2,
    }) as { summary: string; aliases: string[] }
    expect(parsed.summary).toBe('摘要')
    expect(parsed.aliases).toEqual(['别名'])
  })

  it('实体与边的 schema 保留全部字段（含嵌套端点与来源）', () => {
    const entity = memoryEntitySchema.parse({
      id: 'e1', name: '实体', kind: 'tool', aliases: ['别名'], summary: '说明',
      archived: false, createdAt: 1, updatedAt: 2,
    }) as { kind: string; aliases: string[] }
    expect(entity.kind).toBe('tool')
    expect(entity.aliases).toEqual(['别名'])

    const edge = memoryEdgeSchema.parse({
      id: 'memory:a|about|entity:e1',
      from: { kind: 'memory', id: 'a' },
      to: { kind: 'entity', id: 'e1' },
      relation: 'about',
      note: '备注',
      weight: 2,
      origin: 'agent',
      createdAt: 1,
      updatedAt: 2,
    }) as { from: { kind: string; id: string }; weight: number; origin: string }
    expect(edge.from).toEqual({ kind: 'memory', id: 'a' })
    expect(edge.weight).toBe(2)
    expect(edge.origin).toBe('agent')
  })

  it('旧记录缺 summary / aliases 时由 default 补齐', () => {
    const parsed = memoryRecordSchema.parse({ id: 'm1', title: 'T', content: 'C', createdAt: 1, updatedAt: 1 }) as { summary: string; aliases: string[] }
    expect(parsed.summary).toBe('')
    expect(parsed.aliases).toEqual([])
  })
})
