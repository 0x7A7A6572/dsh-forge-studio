import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { aliasId } from '../src/model-key.ts'
import { UsageBillingService } from '../src/service.ts'
import { createUsageBillingSettingsAccess } from '../src/settings.ts'
import { buildByWorkspace, buildDaily, buildOverview, filterRows, mergeByModel } from '../src/view.ts'
import type { Diagnostic, FoldState, LedgerRow, ModelAlias, PriceSnapshot } from '../src/types.ts'

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

function t<V>(): KvTable<string, V> {
  const map = new Map<string, V>()
  return {
    get: (k) => map.get(k), entries: () => map.entries(), keys: () => map.keys(),
    get size() { return map.size },
    put: async (k, v) => { map.set(k, v) }, delete: async (k) => map.delete(k),
    update: async (k, fn) => { const c = map.get(k); if (!c) throw new Error('missing-key'); const n = fn(c); map.set(k, n); return n },
  }
}

describe('手工别名端到端', () => {
  function make() {
    const ledger = t<LedgerRow>(); const aliases = t<ModelAlias>()
    const domain = {
      table: (n: string) => ({
        ledger, aliases, folds: t<FoldState>(), snapshots: t<PriceSnapshot>(), diag: t<Diagnostic>(),
      } as Record<string, unknown>)[n],
    } as never
    const svc = new UsageBillingService(new Context(), {
      domain, settings: createUsageBillingSettingsAccess(), installAt: 0,
      source: { listSessions: async () => [], listEvents: async () => [], readSession: async () => { throw new Error('unused') } },
      fetchPricing: async () => ({ ok: false, reason: 'test' }),
      now: () => 5_000,
    })
    return { svc, ledger }
  }

  it('绑定后展示层合并为一行，账本行数与金额不变', async () => {
    const { svc, ledger } = make()
    await ledger.put('a', row({ id: 'a', model: 'deepseek-v4-flash', costCny: 1 }))
    await ledger.put('b', row({ id: 'b', model: 'deepseek-v4-flash-20260518', costCny: 2 }))
    const before = ledger.size
    expect((await svc.byModel('all', true)).models).toHaveLength(2)

    await svc.setAlias({ provider: 'deepseek', rawModel: 'deepseek-v4-flash-20260518', canonicalModel: 'deepseek-v4-flash' })
    const merged = (await svc.byModel('all', true)).models
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ key: 'deepseek/deepseek-v4-flash', costCny: 3 })
    expect(ledger.size).toBe(before)
    expect(ledger.get('b')!.costCny).toBe(2)
    // 别名只在展示层生效：账本行的 model 必须保持原始 id。展示聚合若把 canonical 写回
    // 行对象（跨层回写），行数与金额断言都会照过，只有这里会红。
    expect(ledger.get('a')!.model).toBe('deepseek-v4-flash')
    expect(ledger.get('b')!.model).toBe('deepseek-v4-flash-20260518')
  })

  it('解绑后恢复两行', async () => {
    const { svc, ledger } = make()
    await ledger.put('a', row({ id: 'a', model: 'deepseek-v4-flash', costCny: 1 }))
    await ledger.put('b', row({ id: 'b', model: 'deepseek-v4-flash-20260518', costCny: 2 }))
    await svc.setAlias({ provider: 'deepseek', rawModel: 'deepseek-v4-flash-20260518', canonicalModel: 'deepseek-v4-flash' })
    await svc.setAlias({ provider: 'deepseek', rawModel: 'deepseek-v4-flash-20260518', canonicalModel: null })
    expect((await svc.byModel('all', true)).models).toHaveLength(2)
    expect(ledger.get('a')!.model).toBe('deepseek-v4-flash')
    expect(ledger.get('b')!.model).toBe('deepseek-v4-flash-20260518')
  })

  it('别名不跨 provider 生效', async () => {
    const { svc, ledger } = make()
    await ledger.put('a', row({ id: 'a', provider: 'deepseek', model: 'relay-x', costCny: 1 }))
    await ledger.put('b', row({ id: 'b', provider: 'relay', model: 'relay-x', costCny: 2 }))
    await svc.setAlias({ provider: 'deepseek', rawModel: 'relay-x', canonicalModel: 'deepseek-v4-flash' })
    const rows = (await svc.byModel('all', true)).models
    expect(rows).toHaveLength(2)
    // 展示键必须逐字钉死：只断言 provider 集合时，一个「按 rawModel 全局解析别名、但仍按
    // provider/canonical 分键」的实现会把 relay-x 改名成 relay/deepseek-v4-flash 却照样两行。
    expect(rows.map((r) => r.provider).sort()).toEqual(['deepseek', 'relay'])
    expect(rows.map((r) => r.key).sort()).toEqual(['deepseek/deepseek-v4-flash', 'relay/relay-x'])
  })
})
