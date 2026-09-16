import { describe, expect, it } from 'vitest'
import { aliasId } from '../src/model-key.ts'
import { buildByWorkspace, buildDaily, buildOverview, filterRows, mergeByModel } from '../src/view.ts'
import type { LedgerRow, ModelAlias } from '../src/types.ts'

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: 's1#1', sessionId: 's1', seq: 1, time: 1_000, provider: 'deepseek',
  model: 'deepseek-v4-flash', day: '2026-09-16', cwd: '/w', isSubagent: false,
  input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0,
  costCny: 1, currency: 'CNY', priced: true, snapshotId: 'snap-1', backfilled: false,
  ...over,
})

describe('mergeByModel', () => {
  it('同 provider 内按别名合并，token 与金额相加', () => {
    const aliases: ModelAlias[] = [{
      id: aliasId('deepseek', 'deepseek-v4-flash-20260518'),
      provider: 'deepseek', rawModel: 'deepseek-v4-flash-20260518', canonicalModel: 'deepseek-v4-flash',
    }]
    const out = mergeByModel([
      row({ id: 'a', model: 'deepseek-v4-flash', costCny: 1 }),
      row({ id: 'b', model: 'deepseek-v4-flash-20260518', costCny: 2 }),
    ], aliases)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'deepseek/deepseek-v4-flash', costCny: 3, calls: 2 })
    expect(out[0]!.rawModels.sort()).toEqual(['deepseek-v4-flash', 'deepseek-v4-flash-20260518'])
  })

  it('不跨 provider 合并同名模型', () => {
    const out = mergeByModel([
      row({ id: 'a', provider: 'deepseek' }),
      row({ id: 'b', provider: 'relay' }),
    ], [])
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.key).sort()).toEqual(['deepseek/deepseek-v4-flash', 'relay/deepseek-v4-flash'])
  })

  it('别名为空 canonical 时不并组（回退原始模型 id）', () => {
    const aliases: ModelAlias[] = ['m-a', 'm-b'].map((raw) => ({
      id: aliasId('deepseek', raw), provider: 'deepseek', rawModel: raw, canonicalModel: '',
    }))
    const out = mergeByModel([
      row({ id: 'a', model: 'm-a' }),
      row({ id: 'b', model: 'm-b' }),
    ], aliases)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.key).sort()).toEqual(['deepseek/m-a', 'deepseek/m-b'])
  })

  it('别名为纯空白 canonical 时同样不并组（回退原始模型 id）', () => {
    const aliases: ModelAlias[] = ['m-a', 'm-b'].map((raw) => ({
      id: aliasId('deepseek', raw), provider: 'deepseek', rawModel: raw, canonicalModel: '   ',
    }))
    const out = mergeByModel([
      row({ id: 'a', model: 'm-a' }),
      row({ id: 'b', model: 'm-b' }),
    ], aliases)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.key).sort()).toEqual(['deepseek/m-a', 'deepseek/m-b'])
  })

  it('不同单价的合并行标 mixedRate', () => {
    const aliases: ModelAlias[] = [{
      id: aliasId('deepseek', 'v4f-x'), provider: 'deepseek', rawModel: 'v4f-x', canonicalModel: 'deepseek-v4-flash',
    }]
    const out = mergeByModel([
      row({ id: 'a', input: 1_000_000, costCny: 1 }),
      row({ id: 'b', model: 'v4f-x', input: 1_000_000, costCny: 3 }),
    ], aliases)
    expect(out[0]!.mixedRate).toBe(true)
  })

  it('同一单价的合并行 mixedRate=false', () => {
    const aliases: ModelAlias[] = [{
      id: aliasId('deepseek', 'v4f-y'), provider: 'deepseek', rawModel: 'v4f-y', canonicalModel: 'deepseek-v4-flash',
    }]
    const out = mergeByModel([
      row({ id: 'a', input: 1_000_000, costCny: 1 }),
      row({ id: 'b', model: 'v4f-y', input: 2_000_000, costCny: 2 }),
    ], aliases)
    expect(out).toHaveLength(1)
    expect(out[0]!.costCny).toBe(3)
    expect(out[0]!.mixedRate).toBe(false)
  })

  it('全未计价的行 priced=false 且不参与 mixedRate 判定', () => {
    const out = mergeByModel([row({ priced: false, costCny: 0 })], [])
    expect(out[0]).toMatchObject({ priced: false, mixedRate: false })
  })

  it('按费用倒序', () => {
    const out = mergeByModel([row({ id: 'a', costCny: 1 }), row({ id: 'b', model: 'other', costCny: 9 })], [])
    expect(out[0]!.costCny).toBe(9)
  })
})

describe('buildDaily', () => {
  it('缺失日期补零且顺序与 days 一致', () => {
    const out = buildDaily([row({ day: '2026-09-16' })], ['2026-09-15', '2026-09-16'])
    expect(out.map((d) => d.day)).toEqual(['2026-09-15', '2026-09-16'])
    expect(out[0]).toMatchObject({ costCny: 0, calls: 0 })
    expect(out[1]).toMatchObject({ costCny: 1, calls: 1 })
  })
})

describe('buildByWorkspace', () => {
  it('按 cwd 归组，cwd 缺失归「未知工作区」，会话按费用倒序', () => {
    const out = buildByWorkspace([
      row({ id: 'a', sessionId: 's1', cwd: '/w', costCny: 1 }),
      row({ id: 'b', sessionId: 's2', cwd: undefined, costCny: 5 }),
    ])
    expect(out.map((w) => w.cwd).sort()).toEqual(['/w', '未知工作区'])
    const unknown = out.find((w) => w.cwd === '未知工作区')!
    expect(unknown.costCny).toBe(5)
    expect(unknown.sessions[0]!.sessionId).toBe('s2')
  })

  it('会话取首个已定义的 cwd，后续行可以补上', () => {
    const out = buildByWorkspace([
      row({ id: 'a', sessionId: 's1', cwd: undefined, costCny: 1 }),
      row({ id: 'b', sessionId: 's1', cwd: '/later', costCny: 2 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.cwd).toBe('/later')
    expect(out[0]!.sessions[0]!.cwd).toBe('/later')
  })
})

describe('filterRows', () => {
  it('可按是否含子代理筛选', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', isSubagent: true })]
    expect(filterRows(rows, { includeSubagents: false })).toHaveLength(1)
    expect(filterRows(rows, { includeSubagents: true })).toHaveLength(2)
  })
})

describe('buildOverview', () => {
  it('汇总总额/今日/本周/日均/缓存命中率/未收录计数/回填标记', () => {
    const rows = [
      row({ id: 'a', day: '2026-09-16', cacheRead: 500_000, input: 500_000, costCny: 1 }),
      row({ id: 'b', day: '2026-09-15', costCny: 3, backfilled: true, priced: false, model: 'mystery' }),
    ]
    const o = buildOverview(rows, { todayKey: '2026-09-16', weekDays: ['2026-09-15', '2026-09-16'] })
    expect(o.totalCny).toBe(4)
    expect(o.todayCny).toBe(1)
    expect(o.weekCny).toBe(4)
    expect(o.avgDailyCny).toBe(2)
    // 用例数据逐字取自 brief：b 行取工厂默认 input=1M，故分母为 2M，命中率期望值由 0.5 修正为 0.25
    // （brief 的用例断言与其实现块互斥，详见 task-9-report.md「brief 矛盾」一节）。
    expect(o.cacheHitRate).toBeCloseTo(0.25, 10)
    expect(o.unpricedRows).toBe(1)
    expect(o.unpricedModels).toEqual(['deepseek/mystery'])
    expect(o.hasBackfilled).toBe(true)
  })

  it('空行集不产生 NaN', () => {
    const o = buildOverview([], { todayKey: '2026-09-16', weekDays: [] })
    expect(o).toMatchObject({ totalCny: 0, todayCny: 0, weekCny: 0, avgDailyCny: 0, cacheHitRate: 0 })
  })
})

describe('聚合不改写输入', () => {
  it('view 聚合不修改传入的 rows 数组与行对象', () => {
    const rows = [
      row({ id: 'a', model: 'v4f-z', costCny: 1, cacheRead: 1_000 }),
      row({ id: 'b', model: 'v4f-z', costCny: 3, cacheRead: 2_000, priced: false, isSubagent: true }),
    ]
    const before = rows.map((r) => ({ ...r }))
    const aliases: ModelAlias[] = [{
      id: aliasId('deepseek', 'v4f-z'), provider: 'deepseek', rawModel: 'v4f-z', canonicalModel: '',
    }]

    mergeByModel(rows, aliases)
    filterRows(rows, { includeSubagents: false })
    buildDaily(rows, ['2026-09-16'])
    buildByWorkspace(rows)
    buildOverview(rows, { todayKey: '2026-09-16', weekDays: ['2026-09-16'] })

    expect(rows).toHaveLength(before.length)
    expect(rows).toEqual(before)
  })
})
