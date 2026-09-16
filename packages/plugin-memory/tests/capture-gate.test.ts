/**
 * capture 的代码级硬闸门（A）与「已有标题」参考注入（B2）。
 *
 * 不变量：提示词只是请求，闸门才是保证 ——
 * - 条数只留前 3 条，第 4 条起记 too-many；
 * - 标题 >40 字 / 正文 >200 字直接丢弃（不截断），40 字与 200 字是允许的边界；
 * - 含换行或列表 / 编号 / markdown 标题标记 → multi-line；进度状态快照 → status-snapshot；
 * - 丢弃项连标题与原因进审计（否则「模型觉得不值得记」和「闸门拦了」分不清）；
 * - 能取到已有标题时，system 提示词在 CAPTURE_PROMPT 之后追加两行参考，取不到就不加。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CAPTURE_MAX_CONTENT_CHARS,
  CAPTURE_MAX_ITEMS,
  CAPTURE_MAX_TITLE_CHARS,
  CAPTURE_PROMPT,
  captureOne,
  isMultiLineContent,
  isStatusSnapshot,
  parseCapturedItems,
} from '../src/agent/capture.ts'
import { MemoryService } from '../src/service.ts'

const item = (overrides: Record<string, unknown> = {}) => ({
  title: '标题', content: '结论正文', kind: 'fact', scope: 'global', ...overrides,
})
const parseOf = (items: unknown[]) => parseCapturedItems(JSON.stringify(items))
const reasonsOf = (items: unknown[]) => parseOf(items).dropped.map((entry) => entry.reason)

describe('多行与状态快照判定', () => {
  it('isMultiLineContent：换行与行首标记', () => {
    expect(isMultiLineContent('一条结论')).toBe(false)
    expect(isMultiLineContent('结论里有 - 破折号和 1. 编号')).toBe(false)
    expect(isMultiLineContent('第一行\n第二行')).toBe(true)
    expect(isMultiLineContent('- 一条')).toBe(true)
    expect(isMultiLineContent('* 一条')).toBe(true)
    expect(isMultiLineContent('+ 一条')).toBe(true)
    expect(isMultiLineContent('• 一条')).toBe(true)
    expect(isMultiLineContent('1. 一条')).toBe(true)
    expect(isMultiLineContent('2) 一条')).toBe(true)
    expect(isMultiLineContent('## 标题')).toBe(true)
  })

  it('isStatusSnapshot：开头特征词与包含特征词', () => {
    expect(isStatusSnapshot('用户偏好回答先给结论')).toBe(false)
    for (const text of ['已发布到 npm', '当前正在推进', '目前方案 A', '正在重构', '待验证', '尚未合并']) {
      expect(isStatusSnapshot(text), text).toBe(true)
    }
    for (const text of ['这个 PR 已合并进主干', 'CI 进行中', '测试全过', 'tsc 干净', 'build 成功', '正在等 CI']) {
      expect(isStatusSnapshot(text), text).toBe(true)
    }
  })
})

describe('parseCapturedItems 硬闸门', () => {
  it('条数超过 3：只留前 3 条，其余记 too-many', () => {
    const parsed = parseOf([
      item({ title: 'T1' }), item({ title: 'T2' }), item({ title: 'T3' }),
      item({ title: 'T4' }), item({ title: 'T5' }),
    ])
    expect(parsed.items.map((entry) => entry.title)).toEqual(['T1', 'T2', 'T3'])
    expect(parsed.items).toHaveLength(CAPTURE_MAX_ITEMS)
    expect(parsed.dropped).toEqual([
      { title: 'T4', reason: 'too-many' },
      { title: 'T5', reason: 'too-many' },
    ])
  })

  it('标题超过 40 字：丢弃 title-too-long（40 字是允许的边界）', () => {
    const parsed = parseOf([
      item({ title: '标'.repeat(CAPTURE_MAX_TITLE_CHARS + 1) }),
      item({ title: '标'.repeat(CAPTURE_MAX_TITLE_CHARS) }),
    ])
    expect(parsed.items.map((entry) => entry.title.length)).toEqual([CAPTURE_MAX_TITLE_CHARS])
    expect(parsed.dropped).toEqual([
      { title: '标'.repeat(CAPTURE_MAX_TITLE_CHARS + 1), reason: 'title-too-long' },
    ])
  })

  it('正文超过 200 字：丢弃 too-long（200 字是允许的边界）', () => {
    const parsed = parseOf([
      item({ content: '甲'.repeat(CAPTURE_MAX_CONTENT_CHARS + 1) }),
      item({ content: '甲'.repeat(CAPTURE_MAX_CONTENT_CHARS) }),
    ])
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]!.content.length).toBe(CAPTURE_MAX_CONTENT_CHARS)
    expect(parsed.dropped).toEqual([{ title: '标题', reason: 'too-long' }])
  })

  it('多行 / 列表 / 编号 / markdown 标题：丢弃 multi-line', () => {
    expect(reasonsOf([
      item({ title: '换行', content: '第一行\n第二行' }),
      item({ title: '列表', content: '- 一条' }),
      item({ title: '编号', content: '1. 一条' }),
    ])).toEqual(['multi-line', 'multi-line', 'multi-line'])
    expect(reasonsOf([item({ title: 'markdown', content: '## 一条' })])).toEqual(['multi-line'])
    expect(reasonsOf([item({ title: '正常', content: '一条结论' })])).toEqual([])
  })

  it('进度 / 状态快照：丢弃 status-snapshot', () => {
    expect(reasonsOf([
      item({ title: '已发布', content: '已发布到 npm' }),
      item({ title: '已合并', content: '这个 PR 已合并进主干' }),
      item({ title: '进行中', content: 'CI 进行中' }),
    ])).toEqual(['status-snapshot', 'status-snapshot', 'status-snapshot'])
    expect(reasonsOf([
      item({ title: '当前', content: '当前正在推进 A 方案' }),
      item({ title: '验证', content: 'tsc 干净、测试全过' }),
      item({ title: '偏好', content: '用户偏好回答先给结论' }),
    ])).toEqual(['status-snapshot', 'status-snapshot'])
  })

  it('丢弃是丢弃：不截断、不进 items', () => {
    const parsed = parseOf([item({ content: '甲'.repeat(CAPTURE_MAX_CONTENT_CHARS + 50) })])
    expect(parsed.items).toEqual([])
    expect(parsed.dropped).toHaveLength(1)
  })
})

/* ---------------- captureOne：丢弃进审计 + 标题参考 ---------------- */

function fakeTable() {
  const rows = new Map<string, unknown>()
  return {
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    put: async (key: string, value: unknown) => { rows.set(key, value) },
    delete: async (key: string) => rows.delete(key),
  }
}

function captureHarness() {
  const tables = {
    memories: fakeTable(),
    raw_documents: fakeTable(),
    audits: fakeTable(),
    entities: fakeTable(),
    edges: fakeTable(),
  }
  const domain = { table: (name: keyof typeof tables) => tables[name] }
  const ctx = new Context()
  return { ctx, service: new MemoryService(ctx, { domain } as never) }
}

/** 越过 80 字的静默门槛，让 captureOne 真的往下走。 */
const LONG_TURN = '这是一段足够长的对话内容，用来越过八十字符的静默门槛。'.repeat(4)

const userTurn = (text: string) => ({
  type: 'user/message',
  data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
})

function sessionWith(events: unknown[], cwd?: string) {
  return {
    id: 'session-gate',
    ...(cwd === undefined ? {} : { header: { cwd } }),
    snapshotEvents: () => events,
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
  }
}

function installLlm(ctx: Context, output: string, capture?: { system?: string }): void {
  const stream = (options: unknown) => {
    if (capture !== undefined) capture.system = (options as { system?: string }).system
    return (async function* () {
      yield { type: 'text-delta', text: output }
      yield { type: 'finish', reason: { kind: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } }
    })()
  }
  ;(ctx as unknown as { provide: (name: string, value: unknown) => void }).provide('llm', { stream })
}

describe('captureOne：闸门与审计', () => {
  it('被拦下的条目连标题与原因进审计，合格的照常写入', async () => {
    const { ctx, service } = captureHarness()
    installLlm(ctx, JSON.stringify([
      { title: '状态', content: '已发布到 npm', kind: 'fact', scope: 'global' },
      { title: '太长', content: '甲'.repeat(CAPTURE_MAX_CONTENT_CHARS + 1), kind: 'fact', scope: 'global' },
      { title: '正常', content: '用户偏好先给结论', kind: 'preference', scope: 'global' },
    ]))
    await captureOne(ctx, service, sessionWith([userTurn(LONG_TURN)]))

    const audits = await service.audits({})
    expect(audits).toHaveLength(1)
    expect(audits[0]?.dropped).toEqual([
      { title: '状态', reason: 'status-snapshot' },
      { title: '太长', reason: 'too-long' },
    ])
    expect((await service.list({})).map((record) => record.title)).toEqual(['正常'])
  })

  it('一条都没采纳时照旧记审计（空结果是正常结果）', async () => {
    const { ctx, service } = captureHarness()
    installLlm(ctx, '[]')
    await captureOne(ctx, service, sessionWith([userTurn(LONG_TURN)]))

    const audits = await service.audits({})
    expect(audits).toHaveLength(1)
    expect(audits[0]?.ok).toBe(true)
    expect(audits[0]?.recordIds).toEqual([])
    expect(audits[0]?.dropped).toBeUndefined()
  })
})

describe('captureOne：已有标题参考（B2）', () => {
  it('候选非空时，在 CAPTURE_PROMPT 之后追加参考标题两行', async () => {
    const { ctx, service } = captureHarness()
    await service.save({ title: '回答风格', content: '先给结论', scope: 'global' })
    const capture: { system?: string } = {}
    installLlm(ctx, '[]', capture)
    await captureOne(ctx, service, sessionWith([userTurn(LONG_TURN)]))

    expect(capture.system).toContain(CAPTURE_PROMPT)
    expect(capture.system).toContain('参考：这个用户已有的相关记忆标题如下')
    expect(capture.system).toContain('- 回答风格')
    expect(capture.system!.startsWith(CAPTURE_PROMPT)).toBe(true)
  })

  it('没有候选标题时就是原提示词，不多一行', async () => {
    const { ctx, service } = captureHarness()
    const capture: { system?: string } = {}
    installLlm(ctx, '[]', capture)
    await captureOne(ctx, service, sessionWith([userTurn(LONG_TURN)]))

    expect(capture.system).toBe(CAPTURE_PROMPT)
  })

  it('只参考全局与当前 cwd 的项目标题，别的项目不出现', async () => {
    const { ctx, service } = captureHarness()
    await service.save({ title: '全局偏好', content: '先给结论', scope: 'global' })
    await service.save({ title: '本项目', content: '用 pnpm', scope: 'project', projectPath: 'D:\\codes\\a' })
    await service.save({ title: '别的项目', content: '用 npm', scope: 'project', projectPath: 'D:\\codes\\b' })
    const capture: { system?: string } = {}
    installLlm(ctx, '[]', capture)
    await captureOne(ctx, service, sessionWith([userTurn(LONG_TURN)], 'D:\\codes\\a'))

    expect(capture.system).toContain('- 全局偏好')
    expect(capture.system).toContain('- 本项目')
    expect(capture.system).not.toContain('别的项目')
  })
})
