/**
 * 摄取管线测试（M1）：「原文留档 → 抽取 → 条目」三段，加上后台调用审计。
 *
 * 关键不变量：
 * - 原文永远先落盘 —— 解析不出条目、模型调用失败，原文都还在，可以重抽；
 * - 会话转录按会话归并成一份，不会每轮堆一份高度重叠的全文；
 * - replace 会把目标作用域的条目与留档一起清掉，不留孤儿原文；
 * - 审计只在真的发生后台模型调用时写，读不到用量就缺省（不估算）。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  compareRawDocuments, dedupeParsedItems, MemoryService, prunableRawIds, rawTitleOf,
} from '../src/service.ts'
import { readUsage } from '../src/agent/capture.ts'
import type { MemoryRawDocument } from '../src/types.ts'

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

describe('摄取管线', () => {
  it('一份原文进来：留档一份、条目若干、抽取痕迹回填', async () => {
    const svc = makeService()
    const result = await svc.ingest({
      text: '## 指令\n- [2026-01-01] 回答先给结论。\n- 不要客套。',
      origin: 'import',
      scope: 'global',
    })

    expect(result.added).toBe(2)
    expect(result.merged).toBe(0)
    expect(result.origin).toBe('import')

    const raw = await svc.getRawDocument(result.rawId)
    expect(raw?.textLength).toBeGreaterThan(0)
    expect(raw?.text).toContain('不要客套')
    expect(raw?.recordIds).toHaveLength(2)
    expect(raw?.extractedAt).toBeGreaterThan(0)

    const records = await svc.list({})
    expect(records).toHaveLength(2)
    expect(records.every((record) => record.source === 'import')).toBe(true)
  })

  it('一条都解析不出来时原文照样留档（以后可以重抽）', async () => {
    const svc = makeService()
    const result = await svc.ingest({ text: '## 认不出的章节标题', scope: 'global' })

    expect(result.added).toBe(0)
    expect(await svc.list({})).toHaveLength(0)
    const docs = await svc.rawDocuments({})
    expect(docs).toHaveLength(1)
    expect(docs[0]?.recordIds).toEqual([])
    // 留档过就算抽过（抽取结果为空 ≠ 未抽取）
    expect(docs[0]?.extractedAt).toBeGreaterThan(0)
  })

  it('重抽复用同一份原文，不产生第二份留档', async () => {
    const svc = makeService()
    const first = await svc.ingest({ text: '## 指令\n- 先给结论。', scope: 'global' })
    const again = await svc.reingest(first.rawId)

    expect(again.rawId).toBe(first.rawId)
    expect(again.merged).toBe(1)
    expect(again.added).toBe(0)
    expect(await svc.rawDocuments({})).toHaveLength(1)
    expect((await svc.getRawDocument(first.rawId))?.recordIds).toHaveLength(1)
  })

  it('replace 把目标作用域的旧条目与旧留档一起清掉', async () => {
    const svc = makeService()
    await svc.ingest({ text: '- 旧条目', scope: 'global', title: '旧' })
    const replaced = await svc.ingest({ text: '- 新条目', scope: 'global', mode: 'replace', title: '新' })

    expect(replaced.removed).toBe(1)
    const docs = await svc.rawDocuments({})
    expect(docs).toHaveLength(1)
    expect(docs[0]?.title).toBe('新')
    expect((await svc.list({})).map((record) => record.content)).toEqual(['新条目'])
  })

  it('replace 只清目标项目，不动别的项目与全局', async () => {
    const svc = makeService()
    await svc.ingest({ text: '- 全局条目', scope: 'global' })
    await svc.ingest({ text: '- A 项目条目', scope: 'project', projectPath: 'D:\\codes\\a' })
    await svc.ingest({ text: '- B 项目条目', scope: 'project', projectPath: 'D:\\codes\\b' })

    await svc.ingest({ text: '- A 新', scope: 'project', projectPath: 'D:\\codes\\a', mode: 'replace' })

    expect(await svc.list({ scope: 'global' })).toHaveLength(1)
    expect((await svc.list({ scope: 'project', projectPath: 'D:\\codes\\b' })).length).toBe(1)
    expect((await svc.list({ scope: 'project', projectPath: 'D:\\codes\\a' })).length).toBe(1)
    expect(await svc.rawDocuments({})).toHaveLength(3)
    expect(await svc.rawDocuments({ projectPath: 'D:\\codes\\a' })).toHaveLength(1)
  })

  it('project 作用域摄取必须给工作区目录', async () => {
    const svc = makeService()
    await expect(svc.ingest({ text: '- x', scope: 'project' })).rejects.toThrow(/project memory requires a project path/)
    await expect(svc.storeRawDocument({ text: 'x', origin: 'capture', scope: 'project' }))
      .rejects.toThrow(/project-scoped raw document/)
  })

  it('列表默认不带全文时只给长度', async () => {
    const svc = makeService()
    await svc.ingest({ text: '- 一条', scope: 'global' })
    const light = await svc.rawDocuments({ includeText: false })
    expect(light[0]?.text).toBe('')
    expect(light[0]?.textLength).toBeGreaterThan(0)
  })

  it('删掉留档不影响已经抽出来的条目', async () => {
    const svc = makeService()
    const result = await svc.ingest({ text: '- 一条', scope: 'global' })
    expect(await svc.removeRawDocument(result.rawId)).toBe(true)
    expect(await svc.rawDocuments({})).toHaveLength(0)
    expect(await svc.list({})).toHaveLength(1)
  })
})

describe('会话转录留档', () => {
  it('同一个会话只留一份，后一轮覆盖前一轮', async () => {
    const svc = makeService()
    const first = await svc.storeRawDocument({
      text: '用户：第一轮', origin: 'capture', scope: 'project', projectPath: 'D:\\codes\\a', sessionId: 's1',
    })
    const second = await svc.storeRawDocument({
      text: '用户：第一轮\n助手：第二轮更长', origin: 'capture', scope: 'project',
      projectPath: 'D:\\codes\\a', sessionId: 's1',
    })
    const other = await svc.storeRawDocument({
      text: '用户：另一个会话', origin: 'capture', scope: 'project', projectPath: 'D:\\codes\\a', sessionId: 's2',
    })

    expect(second.id).toBe(first.id)
    expect(other.id).not.toBe(first.id)
    expect(await svc.rawDocuments({})).toHaveLength(2)
    expect((await svc.getRawDocument(first.id))?.text).toContain('第二轮更长')
    expect((await svc.getRawDocument(first.id))?.createdAt).toBe(first.createdAt)
  })

  it('导入的原文不按会话归并（每份导入都独立留档）', async () => {
    const svc = makeService()
    await svc.storeRawDocument({ text: '第一份', origin: 'import', scope: 'global', sessionId: 's1' })
    await svc.storeRawDocument({ text: '第二份', origin: 'import', scope: 'global', sessionId: 's1' })
    expect(await svc.rawDocuments({})).toHaveLength(2)
  })
})

describe('后台调用审计', () => {
  it('记一条调用；读不到用量就不写 token', async () => {
    const svc = makeService()
    const entry = await svc.recordAudit({
      kind: 'capture', provider: 'p', model: 'm', ok: true,
      durationMs: 1234.6, inputChars: 100, outputChars: 20, recordIds: ['a', 'b'],
    })

    expect(entry.durationMs).toBe(1235)
    expect(entry.tokensIn).toBeUndefined()
    expect(entry.tokensOut).toBeUndefined()
    expect(entry.recordIds).toEqual(['a', 'b'])

    expect(await svc.audits({})).toHaveLength(1)
    expect(await svc.audits({ kind: 'capture' })).toHaveLength(1)
    expect(await svc.audits({ kind: 'entity' })).toHaveLength(0)
    expect(await svc.audits({ ok: false })).toHaveLength(0)
  })

  it('有用量就原样记下，失败也留一条', async () => {
    const svc = makeService()
    await svc.recordAudit({
      kind: 'capture', provider: 'p', model: 'm', ok: false, durationMs: 10,
      inputChars: 5, outputChars: 0, tokensIn: 120, tokensOut: 3,
      recordIds: [], error: 'stream error',
    })
    const failed = await svc.audits({ ok: false })
    expect(failed[0]?.error).toBe('stream error')
    expect(failed[0]?.tokensIn).toBe(120)
  })

  it('审计按时间倒序并按上限截断', async () => {
    const svc = makeService()
    for (let index = 0; index < 3; index += 1) {
      await svc.recordAudit({
        kind: 'capture', provider: 'p', model: 'm', ok: true,
        durationMs: index, inputChars: index, outputChars: index, recordIds: [],
      })
    }
    const all = await svc.audits({ limit: 2 })
    expect(all).toHaveLength(2)
    expect(all[0]!.at).toBeGreaterThanOrEqual(all[1]!.at)
  })

  it('stats 里能看到留档与审计条数', async () => {
    const svc = makeService()
    await svc.ingest({ text: '- 一条', scope: 'global' })
    await svc.recordAudit({
      kind: 'capture', provider: 'p', model: 'm', ok: true,
      durationMs: 1, inputChars: 1, outputChars: 1, recordIds: [],
    })
    const stats = await svc.stats()
    expect(stats.raw).toBe(1)
    expect(stats.audits).toBe(1)
    expect(stats.total).toBe(1)
  })
})

describe('流式用量读取', () => {
  it('只认显式给出的数字，读不到就缺省', () => {
    expect(readUsage({ usage: { inputTokens: 10, outputTokens: 2 } })).toEqual({ inputTokens: 10, outputTokens: 2 })
    expect(readUsage({ usage: { prompt_tokens: 3 } })).toEqual({ inputTokens: 3 })
    expect(readUsage({ usage: { completionTokens: 7 } })).toEqual({ outputTokens: 7 })
    expect(readUsage({ type: 'text-delta', text: 'x' })).toEqual({})
    expect(readUsage({ usage: { inputTokens: 'many' } })).toEqual({})
    expect(readUsage(undefined)).toEqual({})
  })
})

describe('纯函数：去重 / 标题 / 保留上限', () => {
  it('同一份原文里标题重复的条目只留先出现的那个', () => {
    const result = dedupeParsedItems([
      { title: 'A', content: 'a', kind: 'fact' },
      { title: 'a ', content: 'a2', kind: 'fact' },
      { title: 'B', content: 'b', kind: 'fact' },
      { title: '  ', content: 'blank', kind: 'fact' },
    ])
    expect(result.items.map((item) => item.title)).toEqual(['A', 'B'])
    expect(result.skipped).toBe(2)
  })

  it('留档标题取首个正文行并去掉标记', () => {
    expect(rawTitleOf('## 指令\n- 先给结论')).toBe('指令')
    expect(rawTitleOf('\n\n- [2026-01-01] - 先给结论')).toBe('先给结论')
    expect(rawTitleOf('1. 第一条')).toBe('第一条')
    expect(rawTitleOf('   \n  ')).toBe('（空原文）')
    expect(rawTitleOf('长'.repeat(80))).toHaveLength(40)
  })

  it('超出上限时最旧的先被清掉', () => {
    const docs = [1, 2, 3].map((index) => ({
      id: String(index), createdAt: index, updatedAt: index,
    } as unknown as MemoryRawDocument))
    expect(prunableRawIds(docs, 2).map(String)).toEqual(['1'])
    expect(prunableRawIds(docs, 3)).toEqual([])
    expect(prunableRawIds(docs, 0)).toHaveLength(3)
  })

  it('不同来源的留档各自独立成条', async () => {
    const svc = makeService()
    await svc.storeRawDocument({ text: '旧导入', origin: 'import', scope: 'global', title: '旧导入' })
    const fresh = await svc.storeRawDocument({ text: '新导入', origin: 'import', scope: 'global', title: '新导入' })
    const session = await svc.storeRawDocument({
      text: '会话转录（后一轮）', origin: 'capture', scope: 'global', sessionId: 's9',
    })
    expect(session.id).not.toBe(fresh.id)
    expect(await svc.rawDocuments({})).toHaveLength(3)
    expect(await svc.rawDocuments({ origin: 'import' })).toHaveLength(2)
  })

  it('排序看写入时间：被后一轮覆盖过的会话转录排最前', () => {
    const doc = (id: string, createdAt: number, updatedAt: number) =>
      ({ id, createdAt, updatedAt } as unknown as MemoryRawDocument)
    const ordered = [doc('a', 100, 100), doc('b', 200, 200), doc('c', 50, 900)].sort(compareRawDocuments)
    expect(ordered.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })
})
