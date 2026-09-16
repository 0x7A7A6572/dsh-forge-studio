import { describe, expect, it } from 'vitest'
import { diffEntries, planSnapshot, resolveSnapshotAt } from '../src/pricing/snapshot.ts'
import type { PriceEntry, PriceSnapshot } from '../src/types.ts'

const e = (input: number): PriceEntry => ({ input, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY' })

function base(at: number, entries: Record<string, PriceEntry>, usdToCny = 7): PriceSnapshot {
  return { id: `snap-${at}`, at, kind: 'base', reason: 'install', usdToCny, usdToCnySource: 'default', entries }
}

describe('差价计算', () => {
  it('只报新增与变更，不报未变', () => {
    const d = diffEntries({ 'a/1': e(1), 'a/2': e(2) }, { 'a/1': e(1), 'a/2': e(9), 'a/3': e(3) })
    expect(Object.keys(d.entries).sort()).toEqual(['a/2', 'a/3'])
    expect(d.removed).toEqual([])
  })

  it('报删除的 key', () => {
    const d = diffEntries({ 'a/1': e(1), 'a/2': e(2) }, { 'a/1': e(1) })
    expect(d.removed).toEqual(['a/2'])
  })

  it('币种变化也算变更', () => {
    const d = diffEntries(
      { 'a/1': { ...e(1), currency: 'CNY' } },
      { 'a/1': { ...e(1), currency: 'USD' } },
    )
    expect(Object.keys(d.entries)).toEqual(['a/1'])
  })
})

describe('planSnapshot', () => {
  it('首次（prev 为 undefined）产出 base', () => {
    const s = planSnapshot(undefined, { entries: { 'a/1': e(1) }, usdToCny: 7, usdToCnySource: 'default' },
      { id: 'snap-1', at: 100, reason: 'install' })
    expect(s).toMatchObject({ kind: 'base', id: 'snap-1', reason: 'install' })
  })

  it('无变化返回 null（不追加空 delta）', () => {
    const prev = base(100, { 'a/1': e(1) })
    const s = planSnapshot(prev, { entries: { 'a/1': e(1) }, usdToCny: 7, usdToCnySource: 'default' },
      { id: 'snap-2', at: 200, reason: 'catalog-refresh' })
    expect(s).toBeNull()
  })

  it('只有汇率变化也要追加（金额折算依赖它）', () => {
    const prev = base(100, { 'a/1': e(1) }, 7)
    const s = planSnapshot(prev, { entries: { 'a/1': e(1) }, usdToCny: 7.3, usdToCnySource: 'live' },
      { id: 'snap-2', at: 200, reason: 'catalog-refresh' })
    expect(s).toMatchObject({ kind: 'delta', usdToCny: 7.3, usdToCnySource: 'live' })
    expect(s!.entries).toEqual({})
  })

  it('基线是「生效状态」而非上一条记录：delta 账本下的删除仍被看见', () => {
    const b = base(100, { 'a/1': e(1), 'b/1': e(1), 'c/1': e(1) })
    const d: PriceSnapshot = {
      id: 'snap-200#delta', at: 200, kind: 'delta', reason: 'custom-price',
      usdToCny: 7, usdToCnySource: 'default', entries: { 'a/1': e(5) },
    }
    // delta 只含 a/1 的差量；基线若取上一条记录，b/1、c/1 会被当成「不存在」而漏掉。
    const resolved = resolveSnapshotAt(300, [b, d])
    expect(Object.keys(resolved.entries).sort()).toEqual(['a/1', 'b/1', 'c/1'])

    const next = { ...resolved.entries }
    delete next['c/1']
    const s = planSnapshot(resolved, {
      entries: next, usdToCny: resolved.usdToCny, usdToCnySource: resolved.usdToCnySource,
    }, { id: 'snap-300#delta', at: 300, reason: 'catalog-refresh' })
    expect(s).toMatchObject({ kind: 'delta', removed: ['c/1'] })
  })
})

describe('resolveSnapshotAt', () => {
  const s1 = base(100, { 'a/1': e(1), 'a/2': e(2) })
  const s2: PriceSnapshot = {
    id: 'snap-200', at: 200, kind: 'delta', reason: 'catalog-refresh',
    usdToCny: 7.2, usdToCnySource: 'live', entries: { 'a/1': e(5), 'a/3': e(3) },
  }
  const s3: PriceSnapshot = {
    id: 'snap-300', at: 300, kind: 'delta', reason: 'custom-price',
    usdToCny: 7.2, usdToCnySource: 'live', entries: {}, removed: ['a/2'],
  }
  const all = [s1, s2, s3]

  it('t 早于首快照 → 用首快照（回填语义）', () => {
    const r = resolveSnapshotAt(50, all)
    expect(r.entries['a/1']!.input).toBe(1)
    expect(r.snapshotId).toBe('snap-100')
  })

  it('t 落在 base 之后、首个 delta 之前 → base 生效', () => {
    const r = resolveSnapshotAt(150, all)
    expect(r.entries['a/1']!.input).toBe(1)
    expect(r.entries['a/3']).toBeUndefined()
    expect(r.usdToCny).toBe(7)
  })

  it('t 落在 delta 之后 → 累加生效（含汇率）', () => {
    const r = resolveSnapshotAt(250, all)
    expect(r.entries['a/1']!.input).toBe(5)
    expect(r.entries['a/3']!.input).toBe(3)
    expect(r.usdToCny).toBe(7.2)
    expect(r.usdToCnySource).toBe('live')
    expect(r.snapshotId).toBe('snap-200')
  })

  it('removed 生效', () => {
    expect(resolveSnapshotAt(350, all).entries['a/2']).toBeUndefined()
  })

  it('不改动入参（纯函数）', () => {
    const before = JSON.stringify(s1)
    resolveSnapshotAt(350, all)
    expect(JSON.stringify(s1)).toBe(before)
  })

  it('乱序输入也按 at 升序累加', () => {
    expect(resolveSnapshotAt(250, [s3, s1, s2]).entries['a/1']!.input).toBe(5)
  })

  it('不改动输入数组顺序，返回表也不与快照共享条目对象', () => {
    const shuffled = [s3, s1, s2]
    const r = resolveSnapshotAt(250, shuffled)
    expect(shuffled.map((s) => s.id)).toEqual(['snap-300', 'snap-100', 'snap-200'])
    r.entries['a/1']!.input = 999
    expect(s2.entries['a/1']!.input).toBe(5)
    expect(s1.entries['a/1']!.input).toBe(1)
  })

  it('无快照时不抛异常：空表、查不到 key', () => {
    expect(resolveSnapshotAt(123, [])).toEqual({
      entries: {}, usdToCny: 0, usdToCnySource: 'default', snapshotId: '',
    })
    expect(resolveSnapshotAt(123, []).entries['a/1']).toBeUndefined()
  })
})
