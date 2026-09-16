import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { apply, name } from '../src/index.ts'
import type { Diagnostic, FoldState, LedgerRow, ModelAlias, PriceSnapshot } from '../src/types.ts'
import { fakeTable as table } from './fake-table.ts'

/** usage_billing 域的五张假表。 */
function fakeTables() {
  return {
    ledger: table<LedgerRow>(), folds: table<FoldState>(), snapshots: table<PriceSnapshot>(),
    aliases: table<ModelAlias>(), diag: table<Diagnostic>(),
  }
}

/** 提供一个假 storageDomain：open() 返回指向同一组假表的假域（同 plugin-notes 的姿态）。 */
async function provideStorageDomain(ctx: Context, t: ReturnType<typeof fakeTables>): Promise<void> {
  const domain = {
    table: (tableName: string) => (t as unknown as Record<string, KvTable<string, unknown>>)[tableName],
    close: async () => {},
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('storageDomain', { open: async () => domain } as never) })
}

describe('host apply', () => {
  it('导出包名', () => {
    expect(name).toBe('@zzerx/dsh-plugin-usage-billing')
  })

  it('storageDomain 缺失时 apply 不抛（优雅降级）', async () => {
    await expect(apply(new Context())).resolves.toBeUndefined()
  })

  it('账本里已有非 install 记录时，apply 仍写入安装基准快照', async () => {
    const t = fakeTables()
    // 一条非 install 记录先落盘（离线重装 / 先设过自定义价的账本）。
    // 旧的内联实现用 `snapshots.size === 0` 当判据，这种情况下安装基准会永远缺席。
    await t.snapshots.put('snap__custom-price__1', {
      id: 'snap__custom-price__1', at: 1, kind: 'delta', reason: 'custom-price',
      usdToCny: 7.1, usdToCnySource: 'default',
      entries: {
        'deepseek/deepseek-v4-flash': { input: 9, cacheRead: 9, cacheWrite: 9, output: 9, currency: 'CNY' },
      },
    })
    const ctx = new Context()
    await provideStorageDomain(ctx, t)
    await apply(ctx)

    const installs = [...t.snapshots.entries()].map(([, s]) => s).filter((s) => s.reason === 'install')
    expect(installs).toHaveLength(1)
    expect(installs[0]).toMatchObject({ id: 'snap-install', kind: 'base' })
    // 内置价表确实进了安装基准（不是空壳 base）。
    expect(installs[0]!.entries['deepseek/deepseek-v4-pro']).toBeDefined()
    await ctx.fiber.dispose()
  })
})
