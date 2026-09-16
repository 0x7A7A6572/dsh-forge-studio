import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { foldEvents } from '../src/fold.ts'
import type { FoldContext } from '../src/fold.ts'
import type { PriceEntry } from '../src/types.ts'

const header = {
  version: 3, id: 's1', createdAt: 1_700_000_000_000, cwd: 'D:\\codes\\demo', isSeeded: false,
} as unknown as SessionHeader

const TABLE: Record<string, PriceEntry> = {
  'deepseek/deepseek-v4-flash': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY' },
}

function ev(type: string, seq: number, time: number, data: unknown): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

function ctx(over: Partial<FoldContext> = {}): FoldContext {
  return {
    session: header,
    installAt: 1_700_000_100_000,
    aliases: new Map(),
    resolvePrice: () => ({ entries: TABLE, usdToCny: 7, usdToCnySource: 'default', snapshotId: 'snap-1' }),
    ...over,
  }
}

const withUsage = (seq: number, time: number, usage: Record<string, number>) =>
  ev('assistant/message', seq, time, { turn: 1, step: 1, usage })

describe('foldEvents', () => {
  it('request/header 的 config 决定归属', () => {
    const r = foldEvents([
      ev('request/header', 1, 1_700_000_200_000, { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, reason: 'initial' }),
      withUsage(2, 1_700_000_201_000, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ], ctx())
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      id: 's1#2', sessionId: 's1', seq: 2,
      provider: 'deepseek', model: 'deepseek-v4-flash',
      input: 1_000_000, output: 1_000_000, costCny: 2, priced: true, snapshotId: 'snap-1',
      cwd: 'D:\\codes\\demo', isSubagent: false,
    })
  })

  it('request/context 优先于 request/header', () => {
    const r = foldEvents([
      ev('request/header', 1, 1_700_000_200_000, { header: { config: { provider: 'p1', model: 'm1' } }, reason: 'initial' }),
      ev('request/context', 2, 1_700_000_200_500, { provider: 'p2', model: 'm2' }),
      withUsage(3, 1_700_000_201_000, { inputTokens: 1, outputTokens: 0 }),
    ], ctx())
    expect(r.rows[0]).toMatchObject({ provider: 'p2', model: 'm2' })
  })

  it('两者皆缺 → unknown（不丢账）', () => {
    const r = foldEvents([withUsage(1, 1_700_000_201_000, { inputTokens: 5, outputTokens: 0 })], ctx())
    expect(r.rows[0]).toMatchObject({ provider: 'unknown', model: 'unknown', priced: false })
  })

  it('无 usage 的 assistant/message 不计行，但计入调用数', () => {
    const r = foldEvents([
      ev('assistant/message', 1, 1_700_000_201_000, { turn: 1, step: 1 }),
    ], ctx())
    expect(r.rows).toHaveLength(0)
    expect(r.calls).toBe(1)
  })

  it('time < installAt 标 backfilled', () => {
    const r = foldEvents([
      ev('request/context', 1, 1_699_999_000_000, { provider: 'deepseek', model: 'deepseek-v4-flash' }),
      withUsage(2, 1_699_999_000_001, { inputTokens: 1, outputTokens: 0 }),
    ], ctx())
    expect(r.rows[0]!.backfilled).toBe(true)
  })

  it('子代理会话打标并带深度', () => {
    const sub = { ...header, origin: 'subagent', delegationDepth: 1 } as unknown as SessionHeader
    const r = foldEvents([
      ev('request/context', 1, 1_700_000_200_000, { provider: 'deepseek', model: 'deepseek-v4-flash' }),
      withUsage(2, 1_700_000_201_000, { inputTokens: 1, outputTokens: 0 }),
    ], ctx({ session: sub }))
    expect(r.rows[0]).toMatchObject({ isSubagent: true, delegationDepth: 1 })
  })

  it('每行按自身 time 解析价表（写时锁定的核心）', () => {
    const t1 = 1_700_000_200_000
    const t2 = 1_700_000_300_000
    const r = foldEvents([
      ev('request/context', 1, t1, { provider: 'deepseek', model: 'deepseek-v4-flash' }),
      withUsage(2, t1 + 1, { inputTokens: 1_000_000, outputTokens: 0 }),
      withUsage(3, t2, { inputTokens: 1_000_000, outputTokens: 0 }),
    ], ctx({
      resolvePrice: (at) => at < t2
        ? { entries: TABLE, usdToCny: 7, usdToCnySource: 'default', snapshotId: 'snap-old' }
        : { entries: { 'deepseek/deepseek-v4-flash': { ...TABLE['deepseek/deepseek-v4-flash']!, input: 5 } }, usdToCny: 7, usdToCnySource: 'default', snapshotId: 'snap-new' },
    }))
    expect(r.rows[0]).toMatchObject({ costCny: 1, snapshotId: 'snap-old' })
    expect(r.rows[1]).toMatchObject({ costCny: 5, snapshotId: 'snap-new' })
  })

  it('未收录模型记入 unpricedModels 且 priced=false', () => {
    const r = foldEvents([
      ev('request/context', 1, 1_700_000_200_000, { provider: 'x', model: 'mystery' }),
      withUsage(2, 1_700_000_201_000, { inputTokens: 9, outputTokens: 9 }),
    ], ctx())
    expect(r.rows[0]!.priced).toBe(false)
    expect([...r.unpricedModels]).toEqual(['x/mystery'])
  })

  it('返回 lastSeq / lastTime 供水位使用', () => {
    const r = foldEvents([
      ev('turn/start', 1, 1_700_000_200_000, {}),
      ev('turn/end', 7, 1_700_000_205_000, {}),
    ], ctx())
    expect(r).toMatchObject({ lastSeq: 7, lastTime: 1_700_000_205_000 })
  })

  it('空事件序列返回空结果', () => {
    expect(foldEvents([], ctx())).toMatchObject({ rows: [], lastSeq: 0, lastTime: 0, calls: 0 })
  })
})
