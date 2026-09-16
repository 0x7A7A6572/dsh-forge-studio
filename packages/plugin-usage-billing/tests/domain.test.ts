import { describe, expect, it } from 'vitest'
import {
  usageBillingDomain, ledgerRowSchema, priceSnapshotSchema, foldStateSchema, modelAliasSchema,
  diagnosticSchema,
} from '../src/domain.ts'

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

  /**
   * 逐表钉住 **必填字段**：`domain.ts` 的 `as unknown as ZodType<T>` 断言让 schema 与
   * 类型面之间没有编译期联系，字段改名后 parse 会在**读时**悄悄丢掉整条记录
   * （write 侧不报错、read 侧少一行），只有一条「合法记录往返 + 缺必填被拒」的用例
   * 才能在下一次改名时立刻红。
   */
  it('folds：合法往返 + 缺必填被拒', () => {
    const fold = {
      sessionId: 's1', foldedThroughSeq: 7, lastTime: 1758000000000,
      headerCreatedAt: 1757000000000, lastSnapshotId: 'snap-1',
    }
    expect(foldStateSchema.parse(fold)).toMatchObject({ sessionId: 's1', foldedThroughSeq: 7 })
    const { lastSnapshotId, ...rest } = fold
    void lastSnapshotId
    expect(() => foldStateSchema.parse(rest)).toThrow()
  })

  it('aliases：合法往返 + 缺 canonicalModel 被拒', () => {
    const alias = {
      id: 'deepseek\u0000v4f-x', provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: 'deepseek-v4-flash',
    }
    expect(modelAliasSchema.parse(alias)).toMatchObject({ canonicalModel: 'deepseek-v4-flash' })
    const { canonicalModel, ...rest } = alias
    void canonicalModel
    expect(() => modelAliasSchema.parse(rest)).toThrow()
  })

  it('diag：合法往返 + kind 只接受三种取值', () => {
    const diag = { id: 'd1', at: 1, kind: 'pricing-fetch', detail: 'network down' }
    expect(diagnosticSchema.parse(diag).kind).toBe('pricing-fetch')
    expect(() => diagnosticSchema.parse({ ...diag, kind: 'other' })).toThrow()
    const { detail, ...rest } = diag
    void detail
    expect(() => diagnosticSchema.parse(rest)).toThrow()
  })
})
