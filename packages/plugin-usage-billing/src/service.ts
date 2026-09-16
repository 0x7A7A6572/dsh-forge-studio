/**
 * UsageBillingService —— ctx.usageBilling：计费聚合的 host 门面，
 * 同时是 Typert Gateway 的 Remote 服务（SRC 标记模式，无 codegen；照抄
 * plugin-daily-log/src/service.ts 的已验证写法）。
 *
 * 展示数据一律**现算**（账本行 × 当前别名 × 当前价表），不做物化物；
 * 账本行是唯一的持久事实。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { usageBillingDomain } from './domain.ts'
import { aggregateOnce, resetAggregateCache } from './aggregate.ts'
import type { SessionSource } from './aggregate.ts'
import { aliasId, priceKeyCandidates } from './model-key.ts'
import { priceKey } from './pricing/catalog.ts'
import { priceUsage } from './pricing/cost.ts'
import { diffEntries, planSnapshot, resolveSnapshotAt } from './pricing/snapshot.ts'
import { USAGE_BILLING_REMOTE_METHODS, USAGE_BILLING_METHOD_NAMES } from './remote-methods.ts'
import type { UsageBillingSettingsAccess } from './settings.ts'
import { dayKey, daysInRange, rangeToSpec } from './time.ts'
import type { RangeKind } from './time.ts'
import {
  buildBySession, buildByWorkspace, buildDaily, buildOverview, filterRows, mergeByModel,
} from './view.ts'
import type {
  AliasInput, CustomPriceInput, Diagnostic, FoldState, LedgerRow,
  ModelAlias, PriceEntry, PriceSnapshot,
} from './types.ts'

export interface PricingRefreshResult {
  ok: boolean
  reason?: string
  entries?: number
  usdToCny?: number
}

export interface UsageBillingServiceConfig {
  domain: Domain<typeof usageBillingDomain>
  settings: UsageBillingSettingsAccess
  source: SessionSource
  installAt: number
  /** 联网拉价（Task 14 注入真实实现；测试注入假实现）。 */
  fetchPricing: () => Promise<PricingRefreshResult>
  now?: () => number
}

export class UsageBillingService extends TypertRemoteService {
  private readonly ledger: KvTable<string, LedgerRow>
  private readonly folds: KvTable<string, FoldState>
  private readonly snapshots: KvTable<string, PriceSnapshot>
  private readonly aliases: KvTable<string, ModelAlias>
  private readonly diag: KvTable<string, Diagnostic>
  private readonly config: UsageBillingServiceConfig

  constructor(ctx: Context, config: UsageBillingServiceConfig) {
    super(ctx, 'usageBilling')
    this.config = config
    this.ledger = config.domain.table('ledger')
    this.folds = config.domain.table('folds')
    this.snapshots = config.domain.table('snapshots')
    this.aliases = config.domain.table('aliases')
    this.diag = config.domain.table('diag')
  }

  private now(): number { return (this.config.now ?? Date.now)() }

  /** 确保首条 base 快照存在（安装时打点，同时充当回填价表）。 */
  private ensureBaseSnapshot(entries: Record<string, PriceEntry>, usdToCny: number, usdToCnySource: 'live' | 'default'): void {
    if (this.snapshots.size > 0) return
    const snap = planSnapshot(undefined, { entries, usdToCny, usdToCnySource },
      { id: 'snap-install', at: this.config.installAt, reason: 'install' })
    if (snap === null) return
    void this.snapshots.put(snap.id, snap)
    // 写入的价表就是聚合计价用的价表：与 appendDelta / repricing 同规则，必须让
    // TTL 缓存立刻失效，否则最快 5s 内仍在用上一张表算钱。
    resetAggregateCache()
  }

  /** 现算一次聚合（带水位与 TTL），返回账本行快照。 */
  private async rows(): Promise<LedgerRow[]> {
    await aggregateOnce({
      source: this.config.source,
      ledger: this.ledger, folds: this.folds, diag: this.diag,
      aliases: this.aliases, snapshots: this.snapshots,
      installAt: this.config.installAt,
      now: this.config.now,
    })
    return [...this.ledger.entries()].map(([, r]) => r)
  }

  private scoped(rows: LedgerRow[], kind: RangeKind, includeSubagents: boolean): LedgerRow[] {
    const spec = rangeToSpec(kind, this.now())
    return filterRows(rows, { includeSubagents }).filter((r) =>
      (spec.since === null || r.time >= spec.since) && (spec.until === null || r.time <= spec.until))
  }

  private listAliases(): ModelAlias[] { return [...this.aliases.entries()].map(([, a]) => a) }

  /* ---------------- Remote 端点 ---------------- */

  async status(): Promise<{ installAt: number; rows: number; sessions: number; snapshots: number; lastDiag?: Diagnostic }> {
    const diags = [...this.diag.entries()].map(([, d]) => d).sort((a, b) => b.at - a.at)
    const base = {
      installAt: this.config.installAt, rows: this.ledger.size,
      sessions: [...this.folds.entries()].length, snapshots: this.snapshots.size,
    }
    return diags[0] === undefined ? base : { ...base, lastDiag: diags[0] }
  }

  async overview(rangeKind: RangeKind, includeSubagents: boolean) {
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    const now = this.now()
    const todayKey = dayKey(now)
    const weekDays = daysInRange(rangeToSpec('7d', now), now)
    const view = buildOverview(rows, { todayKey, weekDays })
    const cfg = this.config.settings.get()
    return { overview: view, todayKey, budget: { enabled: cfg.budget.enabled, monthlyCny: cfg.budget.monthlyCny } }
  }

  async daily(rangeKind: RangeKind, includeSubagents: boolean) {
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    const days = daysInRange(rangeToSpec(rangeKind, this.now()), this.now())
    return { days: buildDaily(rows, days) }
  }

  async byModel(rangeKind: RangeKind, includeSubagents: boolean) {
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    return { models: mergeByModel(rows, this.listAliases()) }
  }

  async bySession(rangeKind: RangeKind, includeSubagents: boolean) {
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    return { sessions: buildBySession(rows) }
  }

  async byWorkspace(rangeKind: RangeKind, includeSubagents: boolean) {
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    return { workspaces: buildByWorkspace(rows) }
  }

  async pricing(): Promise<{ entries: Record<string, PriceEntry>; usdToCny: number; usdToCnySource: 'live' | 'default'; snapshotId: string }> {
    const all = [...this.snapshots.entries()].map(([, s]) => s)
    return resolveSnapshotAt(this.now(), all)
  }

  async setCustomPrice(entry: CustomPriceInput): Promise<{ ok: true }> {
    const current = await this.pricing()
    const entries = { ...current.entries, [priceKey(entry.provider, entry.model)]: {
      input: entry.input, cacheRead: entry.cacheRead, cacheWrite: entry.cacheWrite,
      output: entry.output, currency: entry.currency,
    } }
    await this.appendDelta(entries, current.usdToCny, current.usdToCnySource, 'custom-price')
    return { ok: true }
  }

  async removeCustomPrice(key: string): Promise<{ ok: boolean }> {
    const current = await this.pricing()
    const catalog = this.catalogValueOf(key)
    const existing = current.entries[key]
    // 目录层有价 → 恢复到目录价（不是把整个模型删掉）；只有「价完全来自自定义」时才删 key。
    if (existing === undefined) return { ok: false }
    if (catalog !== undefined) {
      const same = diffEntries({ [key]: existing }, { [key]: catalog })
      if (Object.keys(same.entries).length === 0 && same.removed.length === 0) return { ok: false }
    }
    const entries = { ...current.entries }
    if (catalog === undefined) delete entries[key]
    else entries[key] = { ...catalog }
    await this.appendDelta(entries, current.usdToCny, current.usdToCnySource, 'custom-price')
    return { ok: true }
  }

  /**
   * 目录层（`install` / `catalog-refresh`）里该 key 的最新取值。
   *
   * 自定义价与手动刷新都写进累计表，所以**无法**从累计表反推「目录原本多少钱」——
   * 只能重放目录层：base 整体替换该层，delta 只增改它提到的 key，`removed` 删 key。
   * `custom-price` / `manual-refresh` 的记录一律不参与这个重放。
   */
  private catalogValueOf(key: string): PriceEntry | undefined {
    const layer: Record<string, PriceEntry> = {}
    const ordered = [...this.snapshots.entries()].map(([, s]) => s)
      .filter((s) => s.reason === 'install' || s.reason === 'catalog-refresh')
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    for (const snap of ordered) {
      if (snap.kind === 'base') for (const k of Object.keys(layer)) delete layer[k]
      for (const [k, v] of Object.entries(snap.entries)) layer[k] = { ...v }
      for (const k of snap.removed ?? []) delete layer[k]
    }
    return layer[key]
  }

  private async appendDelta(
    entries: Record<string, PriceEntry>, usdToCny: number,
    usdToCnySource: 'live' | 'default', reason: PriceSnapshot['reason'],
  ): Promise<void> {
    const all = [...this.snapshots.entries()].map(([, s]) => s)
    // 基线必须是「此刻之前生效的完整状态」；上一条记录可能是 delta，只有差量。
    const prev = all.length === 0 ? undefined : resolveSnapshotAt(this.now(), all)
    const snap = planSnapshot(prev, { entries, usdToCny, usdToCnySource },
      { id: `${prev?.snapshotId ?? 'snap-0'}#delta`, at: this.now(), reason })
    if (snap !== null) await this.snapshots.put(snap.id, snap)
    resetAggregateCache()
  }

  async refreshPricing(force: boolean): Promise<PricingRefreshResult> {
    void force
    const out = await this.config.fetchPricing()
    if (!out.ok) return out
    return out
  }

  async setAlias(input: AliasInput): Promise<{ ok: true }> {
    const id = aliasId(input.provider, input.rawModel)
    if (input.canonicalModel === null) await this.aliases.delete(id)
    else await this.aliases.put(id, {
      id, provider: input.provider.trim().toLowerCase(),
      rawModel: input.rawModel, canonicalModel: input.canonicalModel,
    })
    return { ok: true }
  }

  async aliasList(): Promise<{ aliases: ModelAlias[] }> { return { aliases: this.listAliases() } }

  /** 只重算未计价行（spec §5.7 的唯一例外通道），已锁定行绝不触碰。 */
  async repricing(): Promise<{ changed: number }> {
    const all = [...this.snapshots.entries()].map(([, s]) => s)
    const aliases = new Map(this.listAliases().map((a) => [a.id, a]))
    let changed = 0
    for (const [, row] of this.ledger.entries()) {
      if (row.priced) continue
      const table = resolveSnapshotAt(row.time, all)
      const alias = aliases.get(aliasId(row.provider, row.model))
      const result = priceUsage(
        { inputTokens: row.input, outputTokens: row.output, cacheReadTokens: row.cacheRead, cacheWriteTokens: row.cacheWrite },
        table.entries, priceKeyCandidates(row.provider, row.model, alias), table.usdToCny,
      )
      if (!result.priced) continue
      await this.ledger.put(row.id, { ...row, costCny: result.costCny, currency: result.currency, priced: true, snapshotId: table.snapshotId })
      changed += 1
    }
    resetAggregateCache()
    return { changed }
  }
}

/**
 * Typert SRC 标记：手工复刻 @Remote 装饰器产物（同 alpha.3 稳定契约）。
 * 名单来自 remote-methods.ts —— client descriptors 读同一份，防止参数契约漂移。
 */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

function markRemoteMethods(prototype: object, methods: readonly string[]): void {
  Object.defineProperty(prototype, REMOTE_METHODS, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(methods.map((method) =>
        Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' as const }) }))),
    }),
  })
}

markRemoteMethods(UsageBillingService.prototype, USAGE_BILLING_METHOD_NAMES)

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageBilling: UsageBillingService
  }
}

export { USAGE_BILLING_REMOTE_METHODS }
