import { describe, expect, it } from 'vitest'
import { usageBillingDomain, ledgerRowSchema, priceSnapshotSchema } from '../src/domain.ts'

const row = {
  id: 's1#7', sessionId: 's1', seq: 7, time: 1758000000000,
  provider: 'deepseek', model: 'deepseek-v4-flash', day: '2026-09-16',
  isSubagent: false, input: 100, cacheRead: 20, cacheWrite: 0, output: 30,
  reasoning: 5, costCny: 0.001, currency: 'CNY', priced: true,
  snapshotId: 'snap-1', backfilled: false,
}

describe('usage_billing domain', () => {
  it('暴露五张表', () => {
    expect(Object.keys(usageBillingDomain.tables).sort()).toEqual(
      ['aliases', 'diag', 'folds', 'ledger', 'snapshots'],
    )
  })

  it('账本行合法记录往返通过', () => {
    expect(ledgerRowSchema.parse(row)).toMatchObject({ id: 's1#7', costCny: 0.001 })
  })

  it('账本行缺必填字段被拒', () => {
    const { costCny, ...rest } = row
    expect(() => ledgerRowSchema.parse(rest)).toThrow()
  })

  it('账本行保留未知键（升级兼容）', () => {
    expect((ledgerRowSchema.parse({ ...row, future: 1 }) as unknown as Record<string, unknown>).future).toBe(1)
  })

  it('快照 kind 只接受 base/delta', () => {
    const snap = {
      id: 'snap-1', at: 1, kind: 'base', reason: 'install',
      usdToCny: 7.1, usdToCnySource: 'default', entries: {},
    }
    expect(priceSnapshotSchema.parse(snap).kind).toBe('base')
    expect(() => priceSnapshotSchema.parse({ ...snap, kind: 'other' })).toThrow()
  })
})
