/**
 * 联网价表与汇率：models.dev 实时目录 + open.er-api 汇率。
 *
 * 三条硬要求（spec §6.5）：
 * 1. **只把可解析的部分并进来**，结构不认识就整块丢弃（`projectModelsDev` 永不抛）；
 * 2. 失败一律**降级**到内置价表 + 默认汇率，并在返回值里给出 reason，UI 据此标「内置价」；
 * 3. **只有实质价变才追加 delta 快照**（汇率变化也算，因为金额折算依赖它）。
 *
 * TTL 只在内存里（重启后重新拉一次是可接受的）；durable 的价格记录就是 snapshots 表本身。
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { resetAggregateCache } from '../aggregate.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from './catalog.ts'
import { activeOverridesAt, planSnapshot, resolveSnapshotAt } from './snapshot.ts'
import type { PricingRefreshResult } from '../service.ts'
import type { PriceEntry, PriceSnapshot } from '../types.ts'

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const FX_URL = 'https://open.er-api.com/v6/latest/USD'

/** models.dev 目录里我们关心的成本字段。 */
interface ModelsDevCost { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown }

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

function toEntry(cost: ModelsDevCost): PriceEntry | undefined {
  const input = num(cost.input)
  const output = num(cost.output)
  if (input === undefined || output === undefined) return undefined
  return {
    input, output,
    cacheRead: num(cost.cache_read) ?? 0,
    cacheWrite: num(cost.cache_write) ?? 0,
    currency: 'USD',
  }
}

/** 把 models.dev 的 api.json 投影成 `provider/model` → PriceEntry；结构不认识的部分静默丢弃。 */
export function projectModelsDev(json: unknown): Record<string, PriceEntry> {
  const out: Record<string, PriceEntry> = {}
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return out
  for (const [providerId, provider] of Object.entries(json as Record<string, unknown>)) {
    if (typeof provider !== 'object' || provider === null) continue
    const models = (provider as { models?: unknown }).models
    if (typeof models !== 'object' || models === null || Array.isArray(models)) continue
    for (const [modelId, model] of Object.entries(models as Record<string, unknown>)) {
      if (typeof model !== 'object' || model === null) continue
      const cost = (model as { cost?: unknown }).cost
      if (typeof cost !== 'object' || cost === null) continue
      const entry = toEntry(cost as ModelsDevCost)
      if (entry !== undefined) out[`${providerId.trim().toLowerCase()}/${modelId.trim()}`] = entry
    }
  }
  return out
}

export interface PricingFetchDeps {
  web: { fetch(request: { url: string }, signal?: AbortSignal): Promise<{ url: string; statusCode: number; body: { kind: string; content: string }; truncated: boolean }> }
  snapshots: KvTable<string, PriceSnapshot>
  installAt: number
  now: () => number
}

/** brief 的缺省 TTL = 6h；`settings.pricing.refreshHours` 缺失 / 非正时回退到它。 */
const TTL_MS = 6 * 60 * 60 * 1000
let lastFetch: { at: number; result: PricingRefreshResult } | undefined

/** 配置里的刷新间隔（小时）→ 毫秒；不可用（缺失 / 非有限 / ≤ 0）时回退缺省。 */
function ttlMsOf(refreshHours: number | undefined): number {
  return typeof refreshHours === 'number' && Number.isFinite(refreshHours) && refreshHours > 0
    ? refreshHours * 60 * 60 * 1000
    : TTL_MS
}

export function resetPricingFetchCache(): void { lastFetch = undefined }

/** 取 JSON 文本（fetch 只给 text/html 两种 body，需自行解析）。 */
async function fetchJson(deps: PricingFetchDeps, url: string): Promise<unknown> {
  const res = await deps.web.fetch({ url })
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`HTTP ${res.statusCode}`)
  return JSON.parse(res.body.content) as unknown
}

export async function fetchUsdCny(
  deps: PricingFetchDeps,
): Promise<{ value: number; source: 'live' | 'default' }> {
  try {
    const json = await fetchJson(deps, FX_URL)
    const rates = (json as { rates?: Record<string, unknown> }).rates
    const cny = num(rates?.CNY)
    if (cny === undefined || cny <= 0) throw new Error('CNY 汇率缺失')
    return { value: cny, source: 'live' }
  } catch {
    return { value: DEFAULT_USD_TO_CNY, source: 'default' }
  }
}

export async function fetchPricingFromNetwork(
  deps: PricingFetchDeps,
  force = false,
  refreshHours?: number,
): Promise<PricingRefreshResult> {
  const now = deps.now()
  const ttlMs = ttlMsOf(refreshHours)
  if (!force && lastFetch !== undefined && now - lastFetch.at < ttlMs) {
    return lastFetch.result
  }

  async function run(): Promise<PricingRefreshResult> {
    let fetched: Record<string, PriceEntry>
    try {
      fetched = projectModelsDev(await fetchJson(deps, MODELS_DEV_URL))
    } catch (error) {
      return { ok: false, reason: `models.dev 拉取失败：${error instanceof Error ? error.message : String(error)}` }
    }
    const fx = await fetchUsdCny(deps)
    const all = [...deps.snapshots.entries()].map(([, s]) => s)
    // 刷新写的是**目录层**：先铺内置表与实时目录，再把**仍然生效**的自定义价盖回最上面。
    // 少了最后一步，每次刷新都会把用户设过的自定义价整片抹掉（覆盖价的唯一来源）；
    // 但也不能原样重放整个 custom-price 层——一条「取消记录」携带的是取消当刻的目录价，
    // 整层重放会把它当成自定义价重新盖上，该 key 从此再也跟不上目录调价。
    const overrides = all.length === 0 ? {} : activeOverridesAt(now, all)
    const entries: Record<string, PriceEntry> = { ...BUILTIN_CATALOG, ...fetched, ...overrides }

    // 同 appendDelta：拿完整状态当基线，否则目录里被删掉的模型会永远留在价表里。
    const prev = all.length === 0 ? undefined : resolveSnapshotAt(now, all)
    // 来源是 provenance：实时→默认的同值翻转必须如实写进快照（planSnapshot 也把 source 计入变化），
    // 否则「这次是回退到内置汇率」这件事会被静默抹掉，账本误报为 live。
    const snap = planSnapshot(prev, { entries, usdToCny: fx.value, usdToCnySource: fx.source },
      { id: `${prev?.snapshotId ?? 'snap-0'}#cat-${now}`, at: now, reason: 'catalog-refresh' })
    if (snap !== null) await deps.snapshots.put(snap.id, snap)
    // 价表写入后聚合 TTL 缓存必须立即失效（与 appendDelta / ensureBaseSnapshot 同规则）。
    resetAggregateCache()

    return { ok: true, entries: Object.keys(fetched).length, usdToCny: fx.value }
  }

  const result = await run()
  lastFetch = { at: now, result }
  return result
}
