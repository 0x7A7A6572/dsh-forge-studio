/**
 * 写入上限测试（C2/C3）与提炼提示词限额（C1）。
 *
 * 不变量：
 * - 单条记忆正文有硬上限；超限**拒绝写入并报错**，绝不静默截断；
 * - 同标题合并后的总长也受同一上限约束，超限时原条目保持不变；
 * - 摄取管线遇到超长条目只跳过那一条，其余照常写入（不整批失败）；
 * - 提炼提示词的字数承诺不得大于服务端实际上限。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MEMORY_CONTENT_LIMIT, MemoryService } from '../src/service.ts'
import { CAPTURE_PROMPT } from '../src/agent/capture.ts'
import { MEMORY_USAGE_TEXT } from '../src/agent/prompt.ts'

/** 每个表一个假的 Map 后端（service 只用到 get / entries / put / delete）。 */
function fakeTable() {
  const rows = new Map<string, unknown>()
  return {
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    put: async (key: string, value: unknown) => { rows.set(key, value) },
    delete: async (key: string) => rows.delete(key),
  }
}

function makeService() {
  const tables = { memories: fakeTable(), raw_documents: fakeTable(), audits: fakeTable() }
  const domain = { table: (name: keyof typeof tables) => tables[name] }
  const ctx = new Context()
  return new MemoryService(ctx, { domain } as never)
}

const atLimit = (n: number) => '甲'.repeat(n)

describe('写入长度上限', () => {
  it('正文超过上限：拒绝写入并报出当前字数，库里不出现该条', async () => {
    const svc = makeService()
    await expect(
      svc.save({ title: '太长', content: atLimit(MEMORY_CONTENT_LIMIT + 1), scope: 'global' }),
    ).rejects.toThrow(/上限/)
    expect(await svc.list({ scope: 'global' })).toHaveLength(0)
  })

  it('恰好等于上限：正常写入', async () => {
    const svc = makeService()
    const saved = await svc.save({ title: '刚到上限', content: atLimit(MEMORY_CONTENT_LIMIT), scope: 'global' })
    expect(saved.content.length).toBe(MEMORY_CONTENT_LIMIT)
  })

  it('同标题合并后超过上限：拒绝这回写入，原条目保持不动', async () => {
    const svc = makeService()
    await svc.save({ title: 'T', content: '甲'.repeat(600), scope: 'global' })
    await expect(
      svc.save({ title: 'T', content: '乙'.repeat(600), scope: 'global' }),
    ).rejects.toThrow(/上限/)
    const rows = await svc.list({ scope: 'global' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.content.length).toBe(600)
  })

  it('合并后仍在限内：照常合并更新（回归）', async () => {
    const svc = makeService()
    await svc.save({ title: 'T', content: '甲组', scope: 'global' })
    const merged = await svc.save({ title: 'T', content: '乙组', scope: 'global' })
    expect(merged.content).toContain('甲组')
    expect(merged.content).toContain('乙组')
  })

  it('面板编辑同样受限：updateMemory 超限抛错且不落库', async () => {
    const svc = makeService()
    const saved = await svc.save({ title: 'T', content: '短文', scope: 'global' })
    await expect(
      svc.updateMemory(saved.id, { content: atLimit(MEMORY_CONTENT_LIMIT + 50) }),
    ).rejects.toThrow(/上限/)
    expect((await svc.list({ scope: 'global' }))[0]!.content).toBe('短文')
  })

  it('导入遇到超长条目：只跳过那一条，其余正常写入并计入 skipped', async () => {
    const svc = makeService()
    const result = await svc.ingest({
      text: '## 导入\n- 短句一。\n- ' + atLimit(MEMORY_CONTENT_LIMIT + 10) + '\n- 短句二。',
      origin: 'import',
      scope: 'global',
    })
    expect(result.added).toBe(2)
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    const titles = (await svc.list({ scope: 'global' })).map((r) => r.title)
    expect(titles).toContain('短句一')
    expect(titles).toContain('短句二')
  })
})

describe('提炼提示词限额（C1）', () => {
  it('写明条数与字数上限，并明确不记任务进度与可重跑结果', () => {
    expect(CAPTURE_PROMPT).toContain('最多输出 3 条')
    expect(CAPTURE_PROMPT).toContain('200 字')
    expect(CAPTURE_PROMPT).toMatch(/不要记[\s\S]*进度/)
    expect(CAPTURE_PROMPT).toMatch(/测试全过|build 成功/)
  })

  it('提示词承诺的单条字数不超过服务端硬上限', () => {
    const matched = /每?条.{0,6}?(\d+)\s*字/.exec(CAPTURE_PROMPT)
    expect(matched, '提示词里应出现「N 字」的明确约束').not.toBeNull()
    expect(Number(matched![1])).toBeLessThanOrEqual(MEMORY_CONTENT_LIMIT)
  })
})
describe('整理（tidy）也守上限', () => {
  it('合并重复条目顶破上限时：保留较完整正文，只并标签，不留超长条目', async () => {
    const svc = makeService()
    const a = await svc.save({ title: 'T', content: '甲'.repeat(500), scope: 'global', tags: ['a'] })
    const b = await svc.save({ title: 'U', content: '乙'.repeat(500), scope: 'global', tags: ['b'] })
    await svc.updateMemory(b.id, { title: 'T' })

    const result = await svc.tidy()
    expect(result.merged).toBe(1)
    const rows = await svc.list({ scope: 'global' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.content.length).toBeLessThanOrEqual(MEMORY_CONTENT_LIMIT)
    expect(rows[0]!.tags).toEqual(expect.arrayContaining(['a', 'b']))
    expect(a.id).toBeDefined()
  })
})
describe('使用引导（注入给 agent 的写入纪律）', () => {
  it('写明上限与「不记任务进度 / 可重跑结果」', () => {
    expect(MEMORY_USAGE_TEXT).toContain('800')
    expect(MEMORY_USAGE_TEXT).toMatch(/任务进度|进行中的快照/)
    expect(MEMORY_USAGE_TEXT).toMatch(/测试全过|build 成功|tsc/)
  })
})
