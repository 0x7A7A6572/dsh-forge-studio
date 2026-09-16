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
import type { AggregateStats, SessionSource } from './aggregate.ts'
import { latestDiagnostic } from './diag.ts'
import { aliasId, priceKeyCandidates } from './model-key.ts'
import { DEFAULT_USD_TO_CNY, priceKey } from './pricing/catalog.ts'
import { priceUsage } from './pricing/cost.ts'
import { CATALOG_REASONS, activeOverridesAt, diffEntries, planSnapshot, resolveLayerAt, resolveSnapshotAt } from './pricing/snapshot.ts'
import { USAGE_BILLING_REMOTE_METHODS, USAGE_BILLING_METHOD_NAMES } from './remote-methods.ts'
import type { UsageBillingSettingsAccess } from './settings.ts'
import { SNAPSHOT_BASE_ID, SNAPSHOT_INSTALL_ID, uniqueSnapshotDeltaKey } from './storage-key.ts'
import { dayKey, daysInRange, rangeToSpec } from './time.ts'
import type { RangeKind } from './time.ts'
import {
  buildByWorkspace, buildDaily, buildMarkers, buildOverview, filterRows, mergeByModel,
} from './view.ts'
import type {
  AliasInput, CustomPriceInput, Diagnostic, FoldState, LedgerRow,
  ModelAlias, PriceEntry, PriceSnapshot,
} from './types.ts'

export interface PricingRefreshResult {
  ok: boolean
  reason?: string
  /** **本次**从 models.dev 抓到的条目数，不是在效价表的总量。 */
  entries?: number
  usdToCny?: number
}

export interface UsageBillingServiceConfig {
  domain: Domain<typeof usageBillingDomain>
  settings: UsageBillingSettingsAccess
  source: SessionSource
  installAt: number
  /**
   * 联网拉价（Task 14 注入真实实现；测试注入假实现）。
   * `force` 由「立即刷新」按钮给出（绕过 TTL），`ttlHours` 取自 `settings.pricing.refreshHours`。
   */
  fetchPricing: (options: { force: boolean; ttlHours: number }) => Promise<PricingRefreshResult>
  now?: () => number
}

export class UsageBillingService extends TypertRemoteService {
  private readonly ledger: KvTable<string, LedgerRow>
  private readonly folds: KvTable<string, FoldState>
  private readonly snapshots: KvTable<string, PriceSnapshot>
  private readonly aliases: KvTable<string, ModelAlias>
  private readonly diag: KvTable<string, Diagnostic>
  private readonly config: UsageBillingServiceConfig
  /**
   * 价格写入的串行队列：账本快照是**唯一**持久化价目状态，而每次写入都是
   * 「读当前表 → 算新表 → 追加快照」的读-改-写。同一毫秒内的两次调用若并行，
   * 会各自读到同一份旧表、按照同一个 `(reason, at)` 算出同一个 delta 键，后一次 put
   * 悄悄丢掉前一次的改价。所有触碰价表的写入都必须过这里（键本身由 `storage-key.ts` 生成，
   * 序号只兜住极端撞键，不代替串行化）。
   */
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * 正在跑的那一趟聚合（本实例内**合并**并发调用）。
   *
   * 为什么必须有：侧栏卡片一次就并发发 overview + daily，弹窗再叠几张 tab —— 每个读端点
   * 都要聚合。此前没有任何合并，一次开面板 = 4~6 趟全量扫描同时压在 host 上，磁盘和
   * 事件循环互相踩，看起来就是"所有接口都挂起"。现在同一时刻只有一趟，其余调用共享它。
   * 单实例字段（不是模块级）：测试各自 new 一个服务，不会互相串。
   */
  private pass: Promise<AggregateStats> | undefined

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

  /** 串行执行一次价表读-改-写；前一次失败不让链条卡死（rejection 只影响自己的返回值）。 */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * 确保首条 base 快照存在（安装时打点，同时充当回填价表）。
   *
   * 公开给 host 入口调用：安装基准只有这一份实现（此前的内联副本用 `size === 0` 判据，
   * 账本里只要有任何一条非 install 记录，安装基准就永远缺席）。
   */
  async ensureBaseSnapshot(entries: Record<string, PriceEntry>, usdToCny: number, usdToCnySource: 'live' | 'default'): Promise<void> {
    return this.serialize(async () => {
      // 只看 install 层：先写过自定义价（或任何非 install 快照）不该让安装基准永远缺席。
      if ([...this.snapshots.entries()].some(([, s]) => s.reason === 'install')) return
      const snap = planSnapshot(undefined, { entries, usdToCny, usdToCnySource },
        { id: SNAPSHOT_INSTALL_ID, at: this.config.installAt, reason: 'install' })
      if (snap === null) return
      await this.snapshots.put(snap.id, snap)
      // 写入的价表就是聚合计价用的价表：与 appendDelta / repricing 同规则，必须让
      // TTL 缓存立刻失效，否则最快 5s 内仍在用上一张表算钱。
      resetAggregateCache()
    })
  }

  /**
   * 跑一趟聚合（带变更戳与 TTL），并发调用合并成同一趟。
   *
   * host 入口的预热与所有读端点共用这一条通道，因此"预热还没完时用户点开面板"不会
   * 再起第二趟扫描。
   */
  private aggregatePass(): Promise<AggregateStats> {
    if (this.pass !== undefined) return this.pass
    const run = aggregateOnce({
      source: this.config.source,
      ledger: this.ledger, folds: this.folds, diag: this.diag,
      aliases: this.aliases, snapshots: this.snapshots,
      installAt: this.config.installAt,
      now: this.config.now,
    })
    const tracked = run.finally(() => { if (this.pass === tracked) this.pass = undefined })
    this.pass = tracked
    return tracked
  }

  /** host 入口的预热入口：与读端点共用同一趟合并通道。 */
  warmup(): Promise<AggregateStats> { return this.aggregatePass() }

  /**
   * 读账本快照 —— **不在读路径上等整趟聚合**。
   *
   * 聚合是分钟级的全语料扫描（即便有了变更戳，也仍可能撞上大规模变更），而面板的每一个
   * tab 都调这里。所以：账本已经有行时立刻返回当前快照，下一趟在后台跑完自然生效
   * （stale-while-revalidate）；只有账本还一行都没有（插件刚起来、预热还没落盘）时才等，
   * 否则界面会永远停在空白占位。
   */
  private async rows(): Promise<LedgerRow[]> {
    const pass = this.aggregatePass()
    if (this.ledger.size === 0) await pass.catch((error: unknown) => this.reportBackgroundFailure(error))
    else void pass.catch((error: unknown) => this.reportBackgroundFailure(error))
    return [...this.ledger.entries()].map(([, r]) => r)
  }

  /** 后台失败的唯一出口：吞掉会变成 unhandled rejection，抛出去会打断读端点。 */
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

  /* ---------------- Remote 端点 ---------------- */

  async status(): Promise<{ installAt: number; rows: number; sessions: number; snapshots: number; lastDiag?: Diagnostic }> {
    const base = {
      installAt: this.config.installAt, rows: this.ledger.size,
      sessions: [...this.folds.entries()].length, snapshots: this.snapshots.size,
    }
    // 单遍取最新一条：旧实现每次调用都把整张 diag 表排序（历史上曾积累 3014 条）。
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
    return { overview: view, todayKey, budget: { enabled: cfg.budget.enabled, monthlyCny: cfg.budget.monthlyCny } }
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
    const rows = this.scoped(await this.rows(), rangeKind, includeSubagents)
    return { workspaces: buildByWorkspace(rows), ...buildMarkers(rows) }
  }

  async pricing(): Promise<{
    entries: Record<string, PriceEntry>; usdToCny: number; usdToCnySource: 'live' | 'default'
    snapshotId: string
    /** 当前**仍然生效**的自定义单价 key（费率页据此显示「自定义」与逐行删除）。 */
    customKeys: string[]
  }> {
    const all = [...this.snapshots.entries()].map(([, s]) => s)
    const now = this.now()
    return {
      ...resolveSnapshotAt(now, all),
      customKeys: Object.keys(activeOverridesAt(now, all)).sort(),
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
    })
  }

  /**
   * 目录层（`install` / `catalog-refresh` / `manual-refresh`）里该 key 的最新取值。
   *
   * ⚠️ 已知边界（Task 14 落地时必须复核）：快照记录的 `entries` 是**相对累计表**的差分，
   * 不是分层差分。所以当某个 key 既有自定义价覆盖、目录又改了它的价时，那次目录改动可能
   * 根本没进差分（累计值没变），这里于是恢复出「刷新前的旧目录价」。危害有界且自愈：
   * 下一次目录刷新会把累计表纠正回来，且绝不会恢复出错层的值。
   * 彻底解法是 catalog / override 分层记录差分、解析器按层合成，与目录写入方契约一起在
   * Task 14 定（见 ledger 的 T12 条目）。
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
    // 基线必须是「此刻之前生效的完整状态」；上一条记录可能是 delta，只有差量。
    const at = this.now()
    const prev = all.length === 0 ? undefined : resolveSnapshotAt(at, all)
    // 首条记录就是 base：空表合成出的 0 汇率不是真汇率，写进 base 会让所有 USD 条目永远
    // 算不出钱，必须换成内置兜底汇率并如实标注来源。id 也要诚实——base 不该叫 delta。
    const rate = prev === undefined && !(usdToCny > 0)
      ? { usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'default' as const }
      : { usdToCny, usdToCnySource }
    // 键只由 storage-key.ts 产出（旧的 `${prevId}#delta` 不是路径安全键，真实后端必拒）。
    const id = prev === undefined
      ? SNAPSHOT_BASE_ID
      : uniqueSnapshotDeltaKey(new Set(this.snapshots.keys()), reason, at)
    const snap = planSnapshot(prev, { entries, ...rate }, { id, at, reason })
    if (snap !== null) await this.snapshots.put(snap.id, snap)
    resetAggregateCache()
  }

  async refreshPricing(force: boolean): Promise<PricingRefreshResult> {
    // force 与 TTL 都必须真正送到拉取层：此前两者都被吞掉，「立即刷新」过不了 6h 缓存，
    // 配置里的 refreshHours 也从未被读过（TTL 是硬编码的）。
    const settings = this.config.settings.get()
    // 刷新本身也是「读当前表 → 算新表 → 追加快照」的价表写入，必须与 setCustomPrice /
    // removeCustomPrice 走同一条串行链：否则一次重叠的改价会拿刷新前的旧表当 entries、
    // 却拿刷新后的表当差分基线，把刚拉到的 key 判成 removed、并按旧值把它们加回来。
    return await this.serialize(() =>
      this.config.fetchPricing({ force, ttlHours: settings.pricing.refreshHours }))
  }

  async setAlias(input: AliasInput): Promise<{ ok: true }> {
    const id = aliasId(input.provider, input.rawModel)
    if (input.canonicalModel === null) await this.aliases.delete(id)
    else await this.aliases.put(id, {
      id, provider: input.provider.trim().toLowerCase(),
      rawModel: input.rawModel,
      // 展示合并按 trim 判定，计价解析却按原样拼接 —— 不 trim 就会出现「合并对了、自定义价永远
      // 解析不到」。只去空白，**不要**过 normalizeModelId：带日期的目录 key 必须原样保留。
      canonicalModel: input.canonicalModel.trim(),
    })
    // 别名同时喂给展示合并与计价解析，改完必须让聚合 TTL 缓存失效（与其他写入路径同规则）。
    resetAggregateCache()
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
