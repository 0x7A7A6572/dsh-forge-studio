import { describe, expect, it } from 'vitest'
import { evaluateBudget } from '../src/budget.ts'

const call = (spentCny: number, monthlyCny = 100, notified: Record<string, string> = {}, enabled = true) =>
  evaluateBudget({ spentCny, monthlyCny, enabled, notified, monthKey: '2026-09' })

describe('evaluateBudget', () => {
  it('未开启时永远不提醒，level 为 ok', () => {
    expect(call(999, 100, {}, false)).toMatchObject({ shouldNotify: null, level: 'ok' })
  })

  it('预算为 0 时 pct 记 0 且不提醒（不产生 Infinity）', () => {
    expect(call(10, 0)).toMatchObject({ pct: 0, shouldNotify: null, tier: 0 })
  })

  it('跨 50% 提醒一次，tier 1', () => {
    expect(call(50)).toMatchObject({ tier: 1, shouldNotify: 1, level: 'ok' })
  })

  it('跨 80% 提醒一次，level warn', () => {
    expect(call(80)).toMatchObject({ tier: 2, shouldNotify: 2, level: 'warn' })
  })

  it('跨 100% 提醒一次，level over', () => {
    expect(call(100)).toMatchObject({ tier: 3, shouldNotify: 3, level: 'over' })
  })

  it('已提醒过的档位不重复提醒', () => {
    expect(call(85, 100, { '2026-09': '1' })).toMatchObject({ shouldNotify: 2 })
    expect(call(85, 100, { '2026-09': '2' })).toMatchObject({ shouldNotify: null })
  })

  it('直接冲到 100% 只提醒最高档，不补发低档', () => {
    expect(call(120)).toMatchObject({ shouldNotify: 3 })
  })

  it('跨月重置（旧月记录不影响本月）', () => {
    expect(call(60, 100, { '2026-08': '1' })).toMatchObject({ shouldNotify: 1 })
  })

  it('恰好 50/80/100 的边界算命中', () => {
    expect(call(50).tier).toBe(1)
    expect(call(80).tier).toBe(2)
    expect(call(100).tier).toBe(3)
    expect(call(49.99).tier).toBe(0)
  })

  it('脏值不静默吞掉本月提醒（非数字按 0 处理）', () => {
    expect(call(60, 100, { '2026-09': 'oops' })).toMatchObject({ tier: 1, shouldNotify: 1 })
    expect(call(85, 100, { '2026-09': 'NaN' })).toMatchObject({ tier: 2, shouldNotify: 2 })
  })
})
