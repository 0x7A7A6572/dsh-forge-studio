/**
 * ctx.usageBilling：计费聚合的 host 门面，也是 Typert Remote 服务（SRC 标记，无 codegen）。
 * 展示数据一律现算，账本行是唯一的持久事实。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { usageBillingDomain } from './domain.ts'
import { aggregateOnce, resetAggregateCache } from './aggregate.ts'
import type { AggregateStats, SessionSource } from './aggregate.ts'
import { latestDiagnostic } from './diag.ts'
import { LedgerStore } from './ledger-store.ts'
import { aliasId, priceKeyCandidates } from './model-key.ts'
import { DEFAULT_USD_TO_CNY, priceKey } from './pricing/catalog.ts'
import { priceUsage } from './pricing/cost.ts'
import { holidayDataCovers, isCnHoliday, lastHolidayDataYear } from './pricing/holidays.ts'
import { nextTierSwitchAt, tierAndFactorAt, tierDayProfileAt } from './pricing/tiers.ts'
import type { TierStatus } from './types.ts'
import { CATALOG_REASONS, activeOverridesAt, diffEntries, planSnapshot, resolveLayerAt, resolveSnapshotAt } from './pricing/snapshot.ts'
import { USAGE_BILLING_REMOTE_METHODS, USAGE_BILLING_METHOD_NAMES } from './remote-methods.ts'
import type { UsageBillingSettingsAccess } from './settings.ts'
import { SNAPSHOT_BASE_ID, SNAPSHOT_INSTALL_ID, uniqueSnapshotDeltaKey } from './storage-key.ts'
import { dayKey, daysInRange, rangeToSpec } from './time.ts'
import type { RangeKind } from './time.ts'
import {
  attachAllCny, buildByWorkspace, buildDaily, buildMarkers, buildOverview, filterRows, mergeByModel,
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
  /** 目录被截断，只并入了抢救到的部分。 */
  partial?: boolean
}

export interface UsageBillingServiceConfig {
  domain: Domain<typeof usageBillingDomain>
  settings: UsageBillingSettingsAccess
  source: SessionSource
  installAt: number
  fetchPricing: (options: { force: boolean; ttlHours: number }) => Promise<PricingRefreshResult>
  now?: () => number
}

export class UsageBillingService extends TypertRemoteService {
  private readonly ledger: LedgerStore
  private readonly folds: KvTable<string, FoldState>
  private readonly snapshots: KvTable<string, PriceSnapshot>
  private readonly aliases: KvTable<string, ModelAlias>
  private readonly diag: KvTable<string, Diagnostic>
  private readonly config: UsageBillingServiceConfig
  /** 价表写入串行队列：并行会让两次「读-改-写」丢掉其中一次改价。 */
  private chain: Promise<unknown> = Promise.resolve()

  /** 正在跑的聚合，本实例内合并并发调用。 */
  private pass: Promise<AggregateStats> | undefined

  /** 正在跑的账本分片重建，读路径据此跳过等待。 */
  private rebuilding = false

  constructor(ctx: Context, config: UsageBillingServiceConfig) {
    super(ctx, 'usageBilling')
    this.config = config
    this.ledger = new LedgerStore(config.domain.table('ledger_shards'))
    this.folds = config.domain.table('folds')
    this.snapshots = config.domain.table('snapshots')
    this.aliases = config.domain.table('aliases')
    this.diag = config.domain.table('diag')
  }

  private now(): number { return (this.config.now ?? Date.now)() }

  /** 前一次失败不让链条卡死。 */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  async ensureBaseSnapshot(entries: Record<string, PriceEntry>, usdToCny: number, usdToCnySource: 'live' | 'default'): Promise<void> {
    return this.serialize(async () => {
      if ([...this.snapshots.entries()].some(([, s]) => s.reason === 'install')) return
      const snap = planSnapshot(undefined, { entries, usdToCny, usdToCnySource },
        { id: SNAPSHOT_INSTALL_ID, at: this.config.installAt, reason: 'install' })
      if (snap === null) return
      await this.snapshots.put(snap.id, snap)
      resetAggregateCache()
    })
  }

  private aggregatePass(rebuild = false): Promise<AggregateStats> {
    if (this.pass !== undefined) return this.pass
    const run = aggregateOnce({
      source: this.config.source,
      ledger: this.ledger, folds: this.folds, diag: this.diag,
      aliases: this.aliases, snapshots: this.snapshots,
      // `backfilled` 按首次安装时刻算，不是本次加载时刻。
      installAt: rebuild ? this.installSnapshotAt() : this.config.installAt,
      now: this.config.now,
    }, rebuild ? { force: true, rebuild: true } : {})
    const tracked = run.finally(() => { if (this.pass === tracked) this.pass = undefined })
    this.pass = tracked
    return tracked
  }

  warmup(): Promise<AggregateStats> { return this.aggregatePass() }

  /** `config.installAt` 每次加载都变，所以从 install 快照取。 */
  private installSnapshotAt(): number {
    const install = [...this.snapshots.entries()].find(([, snapshot]) => snapshot.reason === 'install')
    return install === undefined ? this.config.installAt : install[1].at
  }

  /** 忽略水位，全部会话重折一遍，成功后落标记。 */
  async rebuildLedger(): Promise<AggregateStats> {
    this.rebuilding = true
    try {
      const stats = await this.aggregatePass(true)
      if (stats.failures === 0) {
        await this.config.domain.global.set({
          rebuiltAt: this.now(), rebuiltRows: this.ledger.size, rebuiltShards: this.ledger.shardCount,
        })
      }
      return stats
    } finally {
      this.rebuilding = false
    }
  }

  /** 不在读路径上等整趟聚合，已有行就返回当前快照。 */
  private async rows(): Promise<LedgerRow[]> {
    const pass = this.aggregatePass()
    // 重建期间不等，否则分钟级重折会卡住面板。
    if (this.ledger.size === 0 && !this.rebuilding) await pass.catch((error: unknown) => this.reportBackgroundFailure(error))
    else void pass.catch((error: unknown) => this.reportBackgroundFailure(error))
    return this.ledger.all()
  }

  /** 后台失败只在这里报，抛出会打断读端点。 */
  private reportBackgroundFailure(error: unknown): void {
    const logger = (this.ctx as unknown as { logger?: { warn(...args: unknown[]): void } }).logger
    logger?.warn('[plugin-usage-billing] 后台聚合失败：', error)
  }

  private scoped(rows: LedgerRow[], kind: RangeKind, includeSubagents: boolean): LedgerRow[] {
    const spec = rangeToSpec(kind, this.now())
    return filterRows(rows, { includeSubagents }).filter((r) =>
      (spec.since === null || r.time >= spec.since) && (spec.until === null || r.time <= spec.until))
  }

  private listAliases(): ModelAlias[] { return [...this.aliases.entries()].map(([, a]) => a) }

  async status(): Promise<{
    installAt: number; rows: number; sessions: number; snapshots: number
    shards: number
    /** 账本还没就绪，这些数字不是最终值。 */
    rebuild: { active: boolean }
    lastDiag?: Diagnostic
  }> {
    const base = {
      installAt: this.config.installAt, rows: this.ledger.size,
      sessions: [...this.folds.entries()].length, snapshots: this.snapshots.size,
      shards: this.ledger.shardCount,
      rebuild: { active: this.rebuilding },
    }
    const latest = latestDiagnostic(this.diag)
    return latest === undefined ? base : { ...base, lastDiag: latest }
  }

  async overview(rangeKind: RangeKind, includeSubagents: boolean) {
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    const now = this.now()
    const todayKey = dayKey(now)
    const weekDays = daysInRange(rangeToSpec('7d', now), now)
    const view = buildOverview(rows, { todayKey, weekDays })
    const cfg = this.config.settings.get()
    // tierDay 与 todayKey 一样是「今天」的上下文，不受 rangeKind 过滤。
    return {
      overview: view, todayKey,
      budget: { enabled: cfg.budget.enabled, monthlyCny: cfg.budget.monthlyCny },
      tierDay: tierDayProfileAt(now, isCnHoliday),
    }
  }

  async daily(rangeKind: RangeKind, includeSubagents: boolean) {
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    const days = daysInRange(rangeToSpec(rangeKind, this.now()), this.now())
    return { days: buildDaily(rows, days), ...buildMarkers(rows) }
  }

  async byModel(rangeKind: RangeKind, includeSubagents: boolean) {
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    return { models: mergeByModel(rows, this.listAliases()), ...buildMarkers(rows) }
  }

  async byWorkspace(rangeKind: RangeKind, includeSubagents: boolean) {
    const all = await this.rows()
    const rows = this.scoped(all, rangeKind, includeSubagents)
    // 与 overview 用同一个 dayKey(now)。
    const workspaces = buildByWorkspace(rows, dayKey(this.now()))
    // 历史累计从全账本算，不能用窗口里的行。
    attachAllCny(workspaces, all, includeSubagents)
    return { workspaces, ...buildMarkers(rows) }
  }

  async pricing(): Promise<{
    entries: Record<string, PriceEntry>; usdToCny: number; usdToCnySource: 'live' | 'default'
    snapshotId: string
    customKeys: string[]
    /** 未生效规则时 current 为 null。 */
    tier: TierStatus
  }> {
    const all = [...this.snapshots.entries()].map(([, s]) => s)
    const now = this.now()
    const { tier } = tierAndFactorAt(now, isCnHoliday)
    return {
      ...resolveSnapshotAt(now, all),
      customKeys: Object.keys(activeOverridesAt(now, all)).sort(),
      tier: {
        current: tier,
        nextSwitchAt: tier === null ? null : nextTierSwitchAt(now, isCnHoliday),
        holidayDataThrough: holidayDataCovers(now) ? lastHolidayDataYear(now) : lastHolidayDataYear(now),
        day: tierDayProfileAt(now, isCnHoliday),
      },
    }
  }

  async setCustomPrice(entry: CustomPriceInput): Promise<{ ok: true }> {
    return this.serialize(async () => {
      const current = await this.pricing()
      const entries = { ...current.entries, [priceKey(entry.provider, entry.model)]: {
        input: entry.input, cacheRead: entry.cacheRead, cacheWrite: entry.cacheWrite,
        output: entry.output, currency: entry.currency,
      } }
      await this.appendDelta(entries, current.usdToCny, current.usdToCnySource, 'custom-price')
      return { ok: true } as const
    })
  }

  async removeCustomPrice(key: string): Promise<{ ok: boolean }> {
    return this.serialize(async () => {
      const current = await this.pricing()
      const catalog = this.catalogValueOf(key)
      const existing = current.entries[key]
      // 目录层有价就恢复目录价；只有价全来自自定义才删 key。
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
    })
  }

  /**
   * 目录层里该 key 的最新取值。
   * 快照 `entries` 不是分层差分，有自定义价覆盖时会恢复出刷新前的旧目录价。
   */
  private catalogValueOf(key: string): PriceEntry | undefined {
    const all = [...this.snapshots.entries()].map(([, s]) => s)
    return resolveLayerAt(this.now(), all, CATALOG_REASONS).entries[key]
  }

  private async appendDelta(
    entries: Record<string, PriceEntry>, usdToCny: number,
    usdToCnySource: 'live' | 'default', reason: PriceSnapshot['reason'],
  ): Promise<void> {
    const all = [...this.snapshots.entries()].map(([, s]) => s)
    // 基线是此刻之前生效的完整状态，上一条可能只是 delta。
    const at = this.now()
    const prev = all.length === 0 ? undefined : resolveSnapshotAt(at, all)
    // 空表合成出的 0 汇率会让 USD 条目永远算不出钱，首条 base 要用兜底汇率。
    const rate = prev === undefined && !(usdToCny > 0)
      ? { usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'default' as const }
      : { usdToCny, usdToCnySource }
    const id = prev === undefined
      ? SNAPSHOT_BASE_ID
      : uniqueSnapshotDeltaKey(new Set(this.snapshots.keys()), reason, at)
    const snap = planSnapshot(prev, { entries, ...rate }, { id, at, reason })
    if (snap !== null) await this.snapshots.put(snap.id, snap)
    resetAggregateCache()
  }

  async refreshPricing(force: boolean): Promise<PricingRefreshResult> {
    const settings = this.config.settings.get()
    // 刷新也是读-改-写，必须与改价走同一条串行链。
    return await this.serialize(() =>
      this.config.fetchPricing({ force, ttlHours: settings.pricing.refreshHours }))
  }

  async setAlias(input: AliasInput): Promise<{ ok: true }> {
    const id = aliasId(input.provider, input.rawModel)
    if (input.canonicalModel === null) await this.aliases.delete(id)
    else await this.aliases.put(id, {
      id, provider: input.provider.trim().toLowerCase(),
      rawModel: input.rawModel,
      // 只去空白，不要过 normalizeModelId：带日期的目录 key 必须原样保留。
      canonicalModel: input.canonicalModel.trim(),
    })
    resetAggregateCache()
    return { ok: true }
  }

  async aliasList(): Promise<{ aliases: ModelAlias[] }> { return { aliases: this.listAliases() } }

  async repricing(): Promise<{ changed: number }> {
    const all = [...this.snapshots.entries()].map(([, s]) => s)
    const aliases = new Map(this.listAliases().map((a) => [a.id, a]))
    let changed = 0
    const patched: LedgerRow[] = []
    for (const row of this.ledger.all()) {
      if (row.priced) continue
      const table = resolveSnapshotAt(row.time, all)
      const alias = aliases.get(aliasId(row.provider, row.model))
      // 按行自己的时刻判档，不能用 now。
      const { tier, factor } = tierAndFactorAt(row.time, isCnHoliday)
      const result = priceUsage(
        { inputTokens: row.input, outputTokens: row.output, cacheReadTokens: row.cacheRead, cacheWriteTokens: row.cacheWrite },
        table.entries, priceKeyCandidates(row.provider, row.model, alias), table.usdToCny, factor,
      )
      if (!result.priced) continue
      patched.push({
        ...row,
        costCny: result.costCny,
        currency: result.currency,
        priced: true,
        snapshotId: table.snapshotId,
        ...(tier === null ? {} : { tier }),
      })
      changed += 1
    }
    await this.ledger.putMany(patched)
    resetAggregateCache()
    return { changed }
  }
}

/** 手工复刻 @Remote 装饰器产物。名单与 client descriptors 共用 remote-methods.ts。 */
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
