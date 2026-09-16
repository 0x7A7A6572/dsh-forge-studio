import { describe, expect, it } from 'vitest'
import { MAX_DIAGNOSTICS, latestDiagnostic, recordDiagnostic, seenAt, trimDiagnostics } from '../src/diag.ts'
import type { Diagnostic } from '../src/types.ts'
import { fakeTable } from './fake-table.ts'

const legacy = (id: string, at: number): Diagnostic =>
  ({ id, at, kind: 'session-read', detail: 'legacy' } as unknown as Diagnostic)

describe('recordDiagnostic（稳定键 upsert）', () => {
  it('同一 (session, kind) 反复失败只有一个键：累加 count、刷新 lastAt、at 留首次', async () => {
    const table = fakeTable<Diagnostic>()
    await recordDiagnostic(table, { sessionId: 'session-x', kind: 'session-read', detail: 'boom 1', at: 100 })
    await recordDiagnostic(table, { sessionId: 'session-x', kind: 'session-read', detail: 'boom 2', at: 200 })
    await recordDiagnostic(table, { sessionId: 'session-x', kind: 'session-read', detail: 'boom 3', at: 300 })

    expect(table.size).toBe(1)
    const row = [...table.entries()][0]![1]
    expect(row).toMatchObject({
      id: 'diag__session-x__session-read',
      kind: 'session-read',
      at: 100,
      lastAt: 300,
      count: 3,
      detail: 'boom 3',
    })
  })

  it('不同 session 或不同 kind 各自一条', async () => {
    const table = fakeTable<Diagnostic>()
    await recordDiagnostic(table, { sessionId: 'a', kind: 'session-read', detail: 'x', at: 1 })
    await recordDiagnostic(table, { sessionId: 'a', kind: 'pricing-fetch', detail: 'x', at: 1 })
    await recordDiagnostic(table, { sessionId: 'b', kind: 'session-read', detail: 'x', at: 1 })
    expect(table.size).toBe(3)
  })

  it('会话 id 里带 # / NUL / 斜杠也能落盘（键由 storage-key 编码）', async () => {
    const table = fakeTable<Diagnostic>()
    for (const id of ['s#1', 'a/b', 'x\u0000y']) {
      await expect(recordDiagnostic(table, { sessionId: id, kind: 'session-read', detail: 'd', at: 1 })).resolves.toBeUndefined()
    }
    expect(table.size).toBe(3)
  })

  it('老记录（缺 lastAt / count）也按 1 次、按 at 参与计数', async () => {
    const table = fakeTable<Diagnostic>()
    await table.put('diag__old__session-read', legacy('diag__old__session-read', 50))
    await recordDiagnostic(table, { sessionId: 'old', kind: 'session-read', detail: 'again', at: 60 })
    expect(table.size).toBe(1)
    expect(table.get('diag__old__session-read')).toMatchObject({ at: 50, lastAt: 60, count: 2 })
  })
})

describe('trimDiagnostics（上限）', () => {
  it('超过上限时从最旧的开始删，保留最新的 max 条', async () => {
    const table = fakeTable<Diagnostic>()
    for (let i = 0; i < 60; i += 1) {
      await recordDiagnostic(table, { sessionId: `s${i}`, kind: 'session-read', detail: 'x', at: i })
    }
    expect(table.size).toBe(60)
    const removed = await trimDiagnostics(table)
    expect(removed).toBe(10)
    expect(table.size).toBe(MAX_DIAGNOSTICS)
    // 第 0..9 条被删，最新的 59 一定还在。
    expect(table.get('diag__s0__session-read')).toBeUndefined()
    expect(table.get('diag__s9__session-read')).toBeUndefined()
    expect(table.get('diag__s59__session-read')).toBeDefined()
  })

  it('未超限时不动任何记录', async () => {
    const table = fakeTable<Diagnostic>()
    await recordDiagnostic(table, { sessionId: 'a', kind: 'session-read', detail: 'x', at: 1 })
    expect(await trimDiagnostics(table)).toBe(0)
    expect(table.size).toBe(1)
  })

  it('老记录（lastAt = 0）按 at 排序：先被清掉，且清理不抛', async () => {
    const table = fakeTable<Diagnostic>()
    await table.put('diag__old__session-read', legacy('diag__old__session-read', 1))
    expect(seenAt(legacy('x', 7))).toBe(7)
    for (let i = 0; i < MAX_DIAGNOSTICS; i += 1) {
      await recordDiagnostic(table, { sessionId: `n${i}`, kind: 'session-read', detail: 'x', at: 1_000 + i })
    }
    await trimDiagnostics(table)
    expect(table.size).toBe(MAX_DIAGNOSTICS)
    expect(table.get('diag__old__session-read')).toBeUndefined()
  })
})

describe('latestDiagnostic（单遍，不排序）', () => {
  it('取最近被看见的一条，含老记录', async () => {
    const table = fakeTable<Diagnostic>()
    expect(latestDiagnostic(table)).toBeUndefined()
    await recordDiagnostic(table, { sessionId: 'a', kind: 'session-read', detail: 'x', at: 10 })
    await table.put('diag__old__session-read', legacy('diag__old__session-read', 99))
    expect(latestDiagnostic(table)!.id).toBe('diag__old__session-read')
    await recordDiagnostic(table, { sessionId: 'a', kind: 'session-read', detail: 'y', at: 100 })
    expect(latestDiagnostic(table)).toMatchObject({ id: 'diag__a__session-read', lastAt: 100, count: 2 })
  })
})
