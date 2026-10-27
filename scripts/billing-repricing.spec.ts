/**
 * 未计价行的补价口径：价表取当前表（目录后来才收录的模型也能补上），档位仍按事件时刻。
 * 已计价行不重算 —— 写时锁定只对「当时没价」的行开口。
 */
import { describe, expect, it } from 'vitest'
import { planRepricing } from '../packages/plugin-usage-billing/src/pricing/repricing.ts'
import { resolveSnapshotAt } from '../packages/plugin-usage-billing/src/pricing/snapshot.ts'
import type { LedgerRow, PriceEntry, PriceSnapshot } from '../packages/plugin-usage-billing/src/types.ts'

const T0 = Date.UTC(2026, 9, 20, 2) // 北京 2026-10-20 10:00，高峰档
const DAY_MS = 86_400_000

const usd = (input: number, output: number): PriceEntry => ({
  input, output, cacheRead: 0, cacheWrite: 0, currency: 'USD',
})

const snapshot = (id: string, at: number, kind: PriceSnapshot['kind'], entries: Record<string, PriceEntry>): PriceSnapshot => ({
  id, at, kind,
  reason: kind === 'base' ? 'install' : 'catalog-refresh',
  usdToCny: 7.1, usdToCnySource: 'live', entries,
})

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 's1__7', sessionId: 's1', seq: 7, time: T0,
    provider: 'magpie', model: 'codex/gpt-6-astra',
    day: '2026-10-20', isSubagent: false,
    input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0,
    costCny: 0, currency: 'CNY', priced: false, snapshotId: 'snap-install', backfilled: false,
    ...over,
  }
}

/** 安装时目录里还没有这个模型，事件之后目录才收录。 */
const SNAPS = [
  snapshot('snap-install', T0 - DAY_MS, 'base', {}),
  snapshot('snap-refresh', T0 + 1_000, 'delta', { 'openai/gpt-6-astra': usd(10, 0) }),
]

describe('历史行按现价补算', () => {
  it('事件时刻的价表没有该模型，现价表有则补上', () => {
    const historical = resolveSnapshotAt(T0, SNAPS)
    expect(historical.entries['openai/gpt-6-astra']).toBeUndefined()

    const patched = planRepricing([row()], resolveSnapshotAt(T0 + DAY_MS, SNAPS), new Map(), () => false)

    expect(patched).toHaveLength(1)
    expect(patched[0]).toMatchObject({ priced: true, snapshotId: 'snap-refresh' })
    expect(patched[0]!.costCny).toBeCloseTo(71, 6)
  })

  it('已计价行保持原金额与原价表', () => {
    const priced = row({ priced: true, costCny: 1.23, snapshotId: 'snap-install' })
    expect(planRepricing([priced], resolveSnapshotAt(T0 + DAY_MS, SNAPS), new Map(), () => false)).toEqual([])
  })

  it('现价表里也没有的模型保持未计价', () => {
    const missing = row({ model: 'devin/swe-2-max-lightning' })
    expect(planRepricing([missing], resolveSnapshotAt(T0 + DAY_MS, SNAPS), new Map(), () => false)).toEqual([])
  })

  it('档位按事件时刻：同一模型高峰是空闲的两倍', () => {
    const table = resolveSnapshotAt(T0 + DAY_MS, SNAPS)
    const peak = planRepricing([row()], table, new Map(), () => false)[0]!
    const offPeak = planRepricing([row({ time: T0 + 10 * 3_600_000 })], table, new Map(), () => false)[0]!

    expect(peak.tier).toBe('peak')
    expect(offPeak.tier).toBe('offPeak')
    expect(peak.costCny / offPeak.costCny).toBeCloseTo(2, 6)
  })
})
