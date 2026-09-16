/**
 * 语义重叠合并（B1/B2）：归一化与 bigram Dice、同一条事的自动并入、
 * 以及喂给自动提炼的「已有标题」参考。
 *
 * 不变量：
 * - 同 scope + 同 kind + 同归一化标题走原有就地合并；换了说法的同一条事按
 *   标题 Dice ≥ 0.9 或正文 Dice ≥ 0.8 并入（忽略 kind）；
 * - 合并保留原 id 与原标题，只追加正文、取较大重要性、标签并集；
 * - 作用域不越界：别的项目与全局互不污染；
 * - 参考标题清单 = 全局 + 当前 cwd 的项目记忆，按 updatedAt 倒序、去重、限量。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  bigramDice,
  MEMORY_OVERLAP_CONTENT,
  MemoryService,
  normalizeMemoryText,
  overlapScores,
} from '../src/service.ts'

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
  const tables = {
    memories: fakeTable(),
    raw_documents: fakeTable(),
    audits: fakeTable(),
    entities: fakeTable(),
    edges: fakeTable(),
  }
  const domain = { table: (name: keyof typeof tables) => tables[name] }
  const ctx = new Context()
  return new MemoryService(ctx, { domain } as never)
}

/** 让两次写入的 updatedAt 真的错开（时间戳精度是毫秒）。 */
const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms) })

describe('文本归一化与 bigram Dice', () => {
  it('归一化：小写、只留字母数字与汉字', () => {
    expect(normalizeMemoryText('喜欢 简短回答！(Vue3)')).toBe('喜欢简短回答vue3')
    expect(normalizeMemoryText('---')).toBe('')
  })

  it('完全相同 = 1，完全无关 = 0，空串按相等/不等处理', () => {
    expect(bigramDice('喜欢简短回答', '喜欢简短回答')).toBe(1)
    expect(bigramDice('abc', 'xyz')).toBe(0)
    expect(bigramDice('', '')).toBe(1)
    expect(bigramDice('', 'abc')).toBe(0)
  })

  it('单字退化为相等判断（没有二元组可比）', () => {
    expect(bigramDice('甲', '甲')).toBe(1)
    expect(bigramDice('甲', '乙')).toBe(0)
  })

  it('相近文本在阈值之上，无关文本在阈值之下', () => {
    const near = bigramDice(
      normalizeMemoryText('回答先给结论，再给理由，不要客套。'),
      normalizeMemoryText('回答先给结论，再给理由，不要客套'),
    )
    expect(near).toBeGreaterThanOrEqual(MEMORY_OVERLAP_CONTENT)
    expect(bigramDice('回答先给结论', '生产环境用 pnpm 构建')).toBeLessThan(MEMORY_OVERLAP_CONTENT)
  })

  it('overlapScores 同时给出标题分与正文分', () => {
    const scores = overlapScores(
      { title: '回答风格', content: '回答先给结论' },
      { title: '回答风格', content: '回答先给结论，再给理由' },
    )
    expect(scores.titleScore).toBe(1)
    expect(scores.contentScore).toBeGreaterThan(0)
    expect(scores.contentScore).toBeLessThan(1)
  })
})

describe('语义重叠自动合并', () => {
  it('正文高度重叠：并入已有条目，保留原 id 与原标题', async () => {
    const svc = makeService()
    const first = await svc.save({
      title: '回答风格',
      content: '回答先给结论，再给理由，不要客套。',
      scope: 'global',
      importance: 2,
      tags: ['a'],
    })
    const outcome = await svc.saveWithOutcome({
      title: '沟通偏好设置',
      content: '回答先给结论，再给理由，不要客套。',
      scope: 'global',
      importance: 5,
      tags: ['b'],
    })

    expect(outcome.created).toBe(false)
    expect(outcome.mergedBy).toBe('overlap')
    expect(outcome.record.id).toBe(first.id)
    expect(outcome.record.title).toBe('回答风格')
    expect(outcome.record.importance).toBe(5)
    expect(outcome.record.tags).toEqual(['a', 'b'])
    expect(await svc.list({ scope: 'global' })).toHaveLength(1)
  })

  it('标题几乎相同但 kind 不同：也算同一条（重叠忽略 kind）', async () => {
    const svc = makeService()
    await svc.save({ title: '回答风格', content: '回答先给结论。', scope: 'global', kind: 'preference' })
    const outcome = await svc.saveWithOutcome({
      title: '回答风格', content: '再给理由。', scope: 'global', kind: 'fact',
    })

    expect(outcome.created).toBe(false)
    expect(outcome.mergedBy).toBe('overlap')
    const rows = await svc.list({ scope: 'global' })
    expect(rows).toHaveLength(1)
    // 并入已有条目：分类与标题都不动
    expect(rows[0]!.kind).toBe('preference')
    expect(rows[0]!.content).toContain('回答先给结论')
    expect(rows[0]!.content).toContain('再给理由')
  })

  it('标题与正文都不重叠：正常新建', async () => {
    const svc = makeService()
    await svc.save({ title: '回答风格', content: '回答先给结论', scope: 'global' })
    const outcome = await svc.saveWithOutcome({ title: '部署环境', content: '生产环境用 pnpm 构建', scope: 'global' })

    expect(outcome.created).toBe(true)
    expect(outcome.mergedBy).toBeUndefined()
    expect(await svc.list({ scope: 'global' })).toHaveLength(2)
  })

  it('作用域不越界：全局条目不会被项目写入吞掉', async () => {
    const svc = makeService()
    await svc.save({ title: '回答风格', content: '回答先给结论，再给理由。', scope: 'global' })
    const outcome = await svc.saveWithOutcome({
      title: '回答风格', content: '回答先给结论，再给理由。', scope: 'project', projectPath: 'D:\\codes\\a',
    })

    expect(outcome.created).toBe(true)
    expect(await svc.list({ scope: 'global' })).toHaveLength(1)
    expect(await svc.list({ scope: 'project', projectPath: 'D:\\codes\\a' })).toHaveLength(1)
  })

  it('同标题同 kind 仍走原路径（mergedBy=title）', async () => {
    const svc = makeService()
    await svc.save({ title: 'T', content: '甲组', scope: 'global' })
    const outcome = await svc.saveWithOutcome({ title: 'T', content: '乙组', scope: 'global' })
    expect(outcome.created).toBe(false)
    expect(outcome.mergedBy).toBe('title')
  })
})

describe('提炼参考标题（overlapTitleHints）', () => {
  it('取「全局 + 当前项目」，按更新倒序', async () => {
    const svc = makeService()
    await svc.save({ title: '全局偏好', content: '先给结论', scope: 'global' })
    await tick()
    await svc.save({ title: '本项目习惯', content: '用 pnpm', scope: 'project', projectPath: 'D:\\codes\\a' })
    await tick()
    await svc.save({ title: '别的项目', content: '用 npm', scope: 'project', projectPath: 'D:\\codes\\b' })

    expect(svc.overlapTitleHints('D:\\codes\\a')).toEqual(['本项目习惯', '全局偏好'])
    expect(svc.overlapTitleHints('D:\\codes\\b')).toEqual(['别的项目', '全局偏好'])
    expect(svc.overlapTitleHints(undefined)).toEqual(['全局偏好'])
    expect(makeService().overlapTitleHints(undefined)).toEqual([])
  })

  it('去重（归一化标题相同只留一条）与上限生效', async () => {
    const svc = makeService()
    await svc.save({ title: 'T', content: 'a', scope: 'global' })
    await svc.save({ title: ' t ', content: 'b', scope: 'project', projectPath: 'D:\\codes\\a' })
    await svc.save({ title: 'U', content: 'c', scope: 'global' })

    const hints = svc.overlapTitleHints('D:\\codes\\a')
    expect(hints).toHaveLength(2)
    expect(hints.map((title) => title.toLowerCase())).toEqual(expect.arrayContaining(['t', 'u']))
    expect(svc.overlapTitleHints('D:\\codes\\a', 1)).toHaveLength(1)
    expect(svc.overlapTitleHints('D:\\codes\\a', 0)).toEqual([])
  })
})
