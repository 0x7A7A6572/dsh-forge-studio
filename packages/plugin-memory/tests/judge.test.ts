/**
 * 写入去重三件套：A（阈值 0.8 → 0.7）、B（疑似同一条提示）、C（写入时模型判定）。
 *
 * 不变量：
 * - 正文 Dice 落在 0.7~0.8 的「同一条换个说法」会被自动并入（0.8 时代漏掉）；
 * - 没到合并线但很像时，结果里带 suspect，工具文案告诉模型「怎么办」；
 * - 判定 add / update / skip 各自落到 新建 / 并入 / 不写，且每次都记一条审计；
 * - 判定失败 / 抛错 / 开关关掉 / 附近没什么像的 → 一律退化成新建，绝不丢写入；
 * - 判定说「并」但并进去会撞 320 字上限时，同样退化成新建。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  MEMORY_JUDGE_FLOOR, MEMORY_JUDGE_MAX_CANDIDATES, MEMORY_NEAR_FLOOR, MEMORY_OVERLAP_CONTENT,
  MemoryService, overlapScores,
} from '../src/service.ts'
import type { MemoryJudge, MemoryJudgeRequest, MemoryJudgeVerdict, MemoryServiceConfig } from '../src/service.ts'
import {
  JUDGE_MAX_CANDIDATE_CHARS, JUDGE_PROMPT, JUDGE_TIMEOUT_MS, parseJudgeVerdict, renderJudgeInput,
} from '../src/agent/judge.ts'
import { SUSPECT_HINT_PREFIX, renderSaveResult } from '../src/agent/tools.ts'

/** 每张表一个假的 Map 后端（service 只用到 get / entries / put / delete）。 */
function fakeTable() {
  const rows = new Map<string, unknown>()
  return {
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    put: async (key: string, value: unknown) => { rows.set(key, value) },
    delete: async (key: string) => rows.delete(key),
  }
}

function makeService(settings?: { autoJudge: boolean }) {
  const tables = {
    memories: fakeTable(),
    raw_documents: fakeTable(),
    audits: fakeTable(),
    entities: fakeTable(),
    edges: fakeTable(),
  }
  const domain = { table: (name: keyof typeof tables) => tables[name] }
  const ctx = new Context()
  const config: MemoryServiceConfig = {
    domain,
    ...(settings !== undefined
      ? { settings: { get: () => settings as never, update: async () => {}, ready: () => true } }
      : {}),
  } as never
  return new MemoryService(ctx, config)
}

/* ---------------- 受控正文：用互不相同的字，Dice 才能算准 ---------------- */

/** 20 个互不相同的字 → 19 个互不相同的 bigram。 */
const BASE = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉'
/** 前 16 字相同 → 共享 15 个 bigram → Dice ≈ 0.79（0.7 档能并、0.8 档漏）。 */
const CLOSE = BASE.slice(0, 16) + '壹贰叁肆'
/** 前 14 字相同 → 共享 13 个 bigram → Dice ≈ 0.68（低于合并线，高于提示线）。 */
const MID = BASE.slice(0, 14) + '伍陆柒捌玖拾'
/** 前 8 字相同 → Dice ≈ 0.37（低于提示线 0.4，但仍高于判定线 0.2）。 */
const FAR = BASE.slice(0, 8) + '零壹贰叁肆伍陆柒捌拾'
/** 只共享一个字 → Dice ≈ 0.05（连判定线都够不着）。 */
const UNRELATED = BASE.slice(0, 2) + '桌面版安装插件失败时报没有 manifest'

function contentScoreOf(a: string, b: string): number {
  return overlapScores({ title: '关于记忆插件的写入去重策略', content: a },
    { title: '写入去重到底该怎么做才对', content: b }).contentScore
}

function verdictOf(
  decision: 'add' | 'update' | 'skip',
  targetId?: string,
  reason = '测试判定',
): MemoryJudgeVerdict {
  return {
    decision,
    ...(targetId !== undefined ? { targetId: targetId as never } : {}),
    reason,
    meta: {
      ok: true, provider: 'test', model: 'test-model',
      durationMs: 12, inputChars: 100, outputChars: 20,
    },
  }
}

/* ---------------- A：阈值 ---------------- */

describe('A：语义重叠阈值降到 0.7', () => {
  it('常量就是 0.7', () => {
    expect(MEMORY_OVERLAP_CONTENT).toBe(0.7)
  })

  it('0.7~0.8 档的改写稿会被自动并入（0.8 时代会漏成两条）', async () => {
    const score = contentScoreOf(BASE, CLOSE)
    expect(score).toBeGreaterThanOrEqual(0.7)
    expect(score).toBeLessThan(0.8)

    const svc = makeService()
    const first = await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    const second = await svc.saveWithOutcome({ title: '写入去重怎么做的', content: CLOSE, scope: 'global' })
    expect(second.created).toBe(false)
    expect(second.mergedBy).toBe('overlap')
    expect(second.record.id).toBe(first.id)
    expect(await svc.list({})).toHaveLength(1)
  })

  it('相似度只有 0.68 时不自动并入', async () => {
    const score = contentScoreOf(BASE, MID)
    expect(score).toBeLessThan(MEMORY_OVERLAP_CONTENT)
    const svc = makeService()
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    const second = await svc.saveWithOutcome({ title: '写入去重怎么做的', content: MID, scope: 'global' })
    expect(second.created).toBe(true)
    expect(second.mergedBy).toBeUndefined()
  })
})

/* ---------------- B：疑似同一条 ---------------- */

describe('B：疑似同一条提示', () => {
  it('没到合并线但很像 → 结果里带 suspect', async () => {
    const svc = makeService()
    const first = await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    const second = await svc.saveWithOutcome({ title: '写入去重怎么做的', content: MID, scope: 'global' })
    expect(second.suspect?.id).toBe(first.id)
    expect(second.suspect?.title).toBe('记忆插件的写入去重')
    expect(second.suspect?.score).toBeGreaterThanOrEqual(MEMORY_NEAR_FLOOR)
  })

  it('相似度低于提示线就不提示', async () => {
    const svc = makeService()
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    const second = await svc.saveWithOutcome({ title: '桌面版安装插件失败', content: FAR, scope: 'global' })
    expect(second.suspect).toBeUndefined()
  })

  it('另一作用域不参与比较（全局 vs 项目）', async () => {
    const svc = makeService()
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    const second = await svc.saveWithOutcome({
      title: '写入去重怎么做的', content: MID, scope: 'project', projectPath: 'D:/codes/x',
    })
    expect(second.suspect).toBeUndefined()
  })

  it('提示文案说明「怎么办」，且带相似度', () => {
    const text = renderSaveResult({
      saved: { title: '写入去重怎么做的' }, created: true,
      suspect_title: '记忆插件的写入去重', suspect_score: 0.68,
    })
    expect(text).toContain(SUSPECT_HINT_PREFIX)
    expect(text).toContain('记忆插件的写入去重')
    expect(text).toContain('0.68')
    expect(text).toContain('memory_update')
    expect(text).toContain('memory_delete')
    expect(text).toContain('memory_link')
  })

  it('落点文案区分 新建 / 语义合并 / 模型判定 / 未写入', () => {
    const base = { saved: { title: 'T' }, created: true }
    expect(renderSaveResult(base)).toContain('记忆已保存')
    expect(renderSaveResult({ ...base, created: false, merged_by: 'overlap' })).toContain('记忆已合并更新')
    expect(renderSaveResult({ ...base, created: false, merged_by: 'judge' })).toContain('模型判定')
    expect(renderSaveResult({ ...base, created: false, merged_by: 'judge', skipped: true })).toContain('没有写入')
    expect(renderSaveResult({ ...base, judge_reason: '已有那条覆盖了全部要点' })).toContain('已有那条覆盖了全部要点')
  })
})

/* ---------------- C：模型判定 ---------------- */

describe('C：写入判定', () => {
  it('update → 并进目标条目，created=false 且记一条审计', async () => {
    const svc = makeService()
    const first = await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    svc.setJudge(async () => verdictOf('update', first.id))
    const second = await svc.saveWithOutcome({ title: '写入去重怎么做的', content: MID, scope: 'global' })
    expect(second.created).toBe(false)
    expect(second.mergedBy).toBe('judge')
    expect(second.record.id).toBe(first.id)
    expect(second.record.content).toContain(MID)
    expect(second.judged?.decision).toBe('update')
    const audits = await svc.audits({})
    expect(audits).toHaveLength(1)
    expect(audits[0]!.kind).toBe('judge')
    expect(audits[0]!.ok).toBe(true)
    expect(audits[0]!.recordIds).toEqual([first.id])
  })

  it('skip → 不写新条目，返回已有那条', async () => {
    const svc = makeService()
    const first = await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    svc.setJudge(async () => verdictOf('skip', first.id, '已有那条已经覆盖'))
    const second = await svc.saveWithOutcome({ title: '写入去重怎么做的', content: MID, scope: 'global' })
    expect(second.skipped).toBe(true)
    expect(second.created).toBe(false)
    expect(second.record.id).toBe(first.id)
    expect(await svc.list({})).toHaveLength(1)
    expect(second.judged?.reason).toBe('已有那条已经覆盖')
  })

  it('add → 照常新建，且不再提示疑似（以判定结论为准）', async () => {
    const svc = makeService()
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    svc.setJudge(async () => verdictOf('add'))
    const second = await svc.saveWithOutcome({ title: '写入去重怎么做的', content: MID, scope: 'global' })
    expect(second.created).toBe(true)
    expect(second.judged?.decision).toBe('add')
    expect(second.suspect).toBeUndefined()
    expect(await svc.list({})).toHaveLength(2)
  })

  it('判定说并、但并进去会超 320 字 → 退化成新建（不丢写入）', async () => {
    const svc = makeService()
    const first = await svc.save({
      title: '记忆插件的写入去重', content: BASE.repeat(16).slice(0, 300), scope: 'global',
    })
    svc.setJudge(async () => verdictOf('update', first.id))
    const second = await svc.saveWithOutcome({
      title: '写入去重怎么做的', content: MID.repeat(16).slice(0, 300), scope: 'global',
    })
    expect(second.created).toBe(true)
    expect(second.record.id).not.toBe(first.id)
    expect(second.judged?.decision).toBe('update')
  })

  it('判定抛错 → 退化成新建 + 疑似提示', async () => {
    const svc = makeService()
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    svc.setJudge(async () => { throw new Error('boom') })
    const second = await svc.saveWithOutcome({ title: '写入去重怎么做的', content: MID, scope: 'global' })
    expect(second.created).toBe(true)
    expect(second.judged).toBeUndefined()
    expect(second.suspect).toBeDefined()
  })

  it('拿不到路由（判定返回 undefined）→ 退化成新建，且不记审计', async () => {
    const svc = makeService()
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    svc.setJudge(async () => undefined)
    const second = await svc.saveWithOutcome({ title: '写入去重怎么做的', content: MID, scope: 'global' })
    expect(second.created).toBe(true)
    expect(second.suspect).toBeDefined()
    expect(await svc.audits({})).toHaveLength(0)
  })

  it('面板开关关掉就不调用判定', async () => {
    const svc = makeService({ autoJudge: false })
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    let calls = 0
    svc.setJudge(async () => { calls += 1; return verdictOf('update') })
    await svc.saveWithOutcome({ title: '写入去重怎么做的', content: MID, scope: 'global' })
    expect(calls).toBe(0)
  })

  it('附近没有像的条目就不调用判定（省一次调用）', async () => {
    const svc = makeService()
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    let calls = 0
    svc.setJudge(async () => { calls += 1; return verdictOf('add') })
    await svc.saveWithOutcome({ title: '桌面版安装插件失败', content: UNRELATED, scope: 'global' })
    expect(calls).toBe(0)
  })

  it('批量导入不判定（一次几十条就是几十次调用）', async () => {
    const svc = makeService()
    await svc.save({ title: '记忆插件的写入去重', content: BASE, scope: 'global' })
    let calls = 0
    svc.setJudge(async () => { calls += 1; return verdictOf('update') })
    const second = await svc.saveWithOutcome({
      title: '写入去重怎么做的', content: MID, scope: 'global', source: 'import',
    })
    expect(calls).toBe(0)
    expect(second.created).toBe(true)
  })

  it('候选最多 3 条、按相似度降序', async () => {
    const svc = makeService()
    await svc.save({ title: '一号改写稿', content: BASE.slice(0, 13) + '壹贰叁肆伍陆柒', scope: 'global' })
    await svc.save({ title: '二号改写稿', content: BASE.slice(0, 13) + '贰叁肆伍陆柒捌', scope: 'global' })
    await svc.save({ title: '三号改写稿', content: BASE.slice(0, 13) + '叁肆伍陆柒捌玖', scope: 'global' })
    await svc.save({ title: '四号改写稿', content: BASE.slice(0, 13) + '肆伍陆柒捌玖拾', scope: 'global' })
    let seen: MemoryJudgeRequest | undefined
    svc.setJudge(async (request) => { seen = request; return verdictOf('add') })
    await svc.saveWithOutcome({ title: '新的改写稿', content: MID, scope: 'global' })
    expect(seen).toBeDefined()
    expect(seen!.candidates.length).toBeLessThanOrEqual(MEMORY_JUDGE_MAX_CANDIDATES)
    const scores = seen!.candidates.map((candidate) => candidate.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(scores[0]).toBeGreaterThanOrEqual(MEMORY_JUDGE_FLOOR)
  })
})

/* ---------------- 解析与提示词 ---------------- */

describe('判定解析与提示词', () => {
  const ids = ['id-1', 'id-2']

  it('容忍代码块与前后废话', () => {
    const text = '好的，判定如下：\n```json\n{"decision":"update","targetId":"id-2","reason":"同一条"}\n```'
    expect(parseJudgeVerdict(text, ids)).toEqual({ decision: 'update', targetId: 'id-2', reason: '同一条' })
  })

  it('targetId 不在候选里 → 整条作废（宁可新建，也不并错）', () => {
    expect(parseJudgeVerdict('{"decision":"update","targetId":"id-9"}', ids)).toBeUndefined()
    expect(parseJudgeVerdict('{"decision":"skip"}', ids)).toBeUndefined()
  })

  it('decision 非法 / 不是 JSON → undefined', () => {
    expect(parseJudgeVerdict('{"decision":"merge"}', ids)).toBeUndefined()
    expect(parseJudgeVerdict('我觉得应该合并', ids)).toBeUndefined()
    expect(parseJudgeVerdict('{"decision":"add"}', ids)?.decision).toBe('add')
  })

  it('reason 过长会截断', () => {
    const parsed = parseJudgeVerdict('{"decision":"add","reason":"' + 'x'.repeat(200) + '"}', ids)
    expect(parsed?.reason?.length).toBe(60)
  })

  it('renderJudgeInput 带 id / 相似度，并截断候选正文', () => {
    const text = renderJudgeInput({
      title: '新条目', content: '正文', summary: '摘要',
      candidates: [{ id: 'id-1', kind: 'fact', title: '旧条目', content: '甲'.repeat(500), score: 0.68 }],
    })
    expect(text).toContain('待写入的记忆：')
    expect(text).toContain('[id-1] fact / 旧条目（相似度 0.68）')
    expect(text).toContain('甲'.repeat(JUDGE_MAX_CANDIDATE_CHARS) + '…')
    expect(text).not.toContain('甲'.repeat(JUDGE_MAX_CANDIDATE_CHARS + 1))
  })

  it('提示词写明三个动作、且足够短（一次判定约 200 token）', () => {
    expect(JUDGE_PROMPT).toContain('add')
    expect(JUDGE_PROMPT).toContain('update')
    expect(JUDGE_PROMPT).toContain('skip')
    expect(JUDGE_PROMPT).toContain('targetId')
    expect(JUDGE_PROMPT.length).toBeLessThan(700)
    expect(JUDGE_TIMEOUT_MS).toBeLessThanOrEqual(20000)
  })

  it('三个阈值大小关系合理：判定线 < 提示线 < 合并线', () => {
    expect(MEMORY_JUDGE_FLOOR).toBeLessThan(MEMORY_NEAR_FLOOR)
    expect(MEMORY_NEAR_FLOOR).toBeLessThan(MEMORY_OVERLAP_CONTENT)
  })
})
