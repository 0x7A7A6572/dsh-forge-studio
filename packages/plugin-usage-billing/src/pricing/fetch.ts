/**
 * 联网价表与汇率：拉 models.dev 目录与 open.er-api 汇率，并入 snapshots 表。
 * TTL 只在内存，重启后重新拉取一次。
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { resetAggregateCache } from '../aggregate.ts'
import { SNAPSHOT_BASE_ID, uniqueSnapshotDeltaKey } from '../storage-key.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from './catalog.ts'
import { CATALOG_REASONS, activeOverridesAt, planSnapshot, resolveLayerAt, resolveSnapshotAt } from './snapshot.ts'
import { salvageJsonPrefix } from './salvage.ts'
import type { PricingRefreshResult } from '../service.ts'
import type { PriceEntry, PriceSnapshot } from '../types.ts'

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const FX_URL = 'https://open.er-api.com/v6/latest/USD'

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
  /** 宿主抓取面（ctx.web.fetch）；`truncated` 指宿主按单次响应上限砍过 body。 */
  web: { fetch(request: { url: string }, signal?: AbortSignal): Promise<{ url: string; statusCode: number; body: { kind: string; content: string }; truncated: boolean }> }
  snapshots: KvTable<string, PriceSnapshot>
  now: () => number
}

const TTL_MS = 6 * 60 * 60 * 1000
const FAILURE_TTL_MS = 60_000
const MAX_REFRESH_HOURS = 24 * 30

interface PricingFetchState {
  last?: { at: number; result: PricingRefreshResult; ttlMs: number }
  inFlight?: Promise<PricingRefreshResult>
}

let states = new WeakMap<KvTable<string, PriceSnapshot>, PricingFetchState>()

export function resetPricingFetchCache(): void { states = new WeakMap() }

function stateOf(deps: PricingFetchDeps): PricingFetchState {
  let state = states.get(deps.snapshots)
  if (state === undefined) { state = {}; states.set(deps.snapshots, state) }
  return state
}

function ttlMsOf(refreshHours: number | undefined): number {
  if (typeof refreshHours !== 'number' || !Number.isFinite(refreshHours) || refreshHours <= 0) return TTL_MS
  return Math.min(refreshHours, MAX_REFRESH_HOURS) * 60 * 60 * 1000
}

const TRUNCATED = '响应被截断（超过宿主单次抓取上限），本次不合并半份目录'

/**
 * 取 JSON 文本；allowPartial 时抢救被截断响应的完整前缀。
 * 汇率页一律不救：半截的汇率会静默缩放全部金额。
 */
async function fetchJson(
  deps: PricingFetchDeps, url: string, allowPartial = false,
): Promise<{ json: unknown; partial: boolean }> {
  const res = await deps.web.fetch({ url })
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`HTTP ${res.statusCode}`)
  if (!res.truncated) return { json: JSON.parse(res.body.content) as unknown, partial: false }
  const repaired = allowPartial ? salvageJsonPrefix(res.body.content) : null
  if (repaired === null) throw new Error(TRUNCATED)
  try {
    return { json: JSON.parse(repaired) as unknown, partial: true }
  } catch {
    throw new Error(TRUNCATED)
  }
}

export async function fetchUsdCny(
  deps: PricingFetchDeps,
): Promise<{ value: number; source: 'live' | 'default' }> {
  try {
    const { json } = await fetchJson(deps, FX_URL)
    const rates = (json as { rates?: Record<string, unknown> }).rates
    const cny = num(rates?.CNY)
    if (cny === undefined || cny <= 0) throw new Error('CNY 汇率缺失')
    return { value: cny, source: 'live' }
  } catch {
    return { value: DEFAULT_USD_TO_CNY, source: 'default' }
  }
}

async function runRefresh(deps: PricingFetchDeps, now: number): Promise<PricingRefreshResult> {
  let fetched: Record<string, PriceEntry>
  let partial = false
  try {
    const res = await fetchJson(deps, MODELS_DEV_URL, true)
    partial = res.partial
    fetched = projectModelsDev(res.json)
  } catch (error) {
    return { ok: false, reason: `models.dev 拉取失败：${error instanceof Error ? error.message : String(error)}` }
  }
  if (Object.keys(fetched).length === 0) {
    return { ok: false, reason: 'models.dev 目录解析为空：本次未取到任何模型价（保留在效价表）' }
  }
  const fx = await fetchUsdCny(deps)
  const all = [...deps.snapshots.entries()].map(([, s]) => s)
  // 刷新只写目录层，再盖上仍然生效的自定义价。
  // 不能整层重放：取消记录会被当自定义价盖回，跟不上目录调价。
  const overrides = all.length === 0 ? {} : activeOverridesAt(now, all)
  // 部分目录只增不删：缺 key 是没抓到，不是目录已删。
  const baseline = partial && all.length > 0 ? resolveLayerAt(now, all, CATALOG_REASONS).entries : {}
  const entries: Record<string, PriceEntry> = { ...baseline, ...BUILTIN_CATALOG, ...fetched, ...overrides }

  const prev = all.length === 0 ? undefined : resolveSnapshotAt(now, all)
  const id = prev === undefined
    ? SNAPSHOT_BASE_ID
    : uniqueSnapshotDeltaKey(new Set(deps.snapshots.keys()), 'catalog-refresh', now)
  const snap = planSnapshot(prev, { entries, usdToCny: fx.value, usdToCnySource: fx.source },
    { id, at: now, reason: 'catalog-refresh' })
  if (snap !== null) {
    await deps.snapshots.put(snap.id, snap)
    resetAggregateCache()
  }

  return { ok: true, entries: Object.keys(fetched).length, usdToCny: fx.value, ...(partial ? { partial: true } : {}) }
}

export async function fetchPricingFromNetwork(
  deps: PricingFetchDeps,
  force = false,
  refreshHours?: number,
): Promise<PricingRefreshResult> {
  const now = deps.now()
  const ttlMs = ttlMsOf(refreshHours)
  const state = stateOf(deps)
  const last = state.last
  if (!force && last !== undefined && now - last.at < last.ttlMs) {
    return last.result
  }
  if (state.inFlight !== undefined) return await state.inFlight
  const run = runRefresh(deps, now)
  state.inFlight = run
  try {
    const result = await run
    state.last = { at: now, result, ttlMs: result.ok ? ttlMs : Math.min(ttlMs, FAILURE_TTL_MS) }
    return result
  } finally {
    state.inFlight = undefined
  }
}
