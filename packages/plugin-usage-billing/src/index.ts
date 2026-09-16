/**
 * @zzerx/dsh-plugin-usage-billing —— host 入口。
 * 打开 usage_billing 域 → 提供 ctx.usageBilling 服务 → 注册设置命名空间 →
 * 打 base 价表快照 → 起后台刷新与预热聚合。
 *
 * storageDomain 未装配时整体降级（不抛），与 plugin-daily-log 的容错姿态一致。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { usageBillingDomain } from './domain.ts'
import { UsageBillingService } from './service.ts'
import { installUsageBillingSettings } from './settings.ts'
import { aggregateOnce, resetAggregateCache } from './aggregate.ts'
import type { SessionSource } from './aggregate.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from './pricing/catalog.ts'
import { planSnapshot } from './pricing/snapshot.ts'
import { fetchPricingFromNetwork } from './pricing/fetch.ts'

export const name = '@zzerx/dsh-plugin-usage-billing'
export const inject = ['storageDomain']

const REFRESH_CHECK_MS = 60_000

/**
 * sessionQuery 服务的最小视图：它是可选依赖，`ctx.get` 返回 any，
 * 这里显式收窄（同 plugin-daily-log 的 WorkspaceRegistryLike 姿态）。
 */
interface SessionQueryLike {
  listSessions(): Promise<Array<{ header: SessionHeader }>>
  listEvents(id: string): Promise<Array<{ seq: number }>>
  readSession(id: string): Promise<{ session: SessionHeader; events: SessionEvent[] }>
}

export async function apply(ctx: Context): Promise<void> {
  const domainService = ctx.get('storageDomain')
  if (domainService === undefined) {
    ctx.logger.warn('[plugin-usage-billing] storageDomain 未装配，计费聚合不可用（插件已降级）')
    return
  }

  const domain = await domainService.open(usageBillingDomain)
  ctx.effect(() => () => { void domain.close() })

  const settings = installUsageBillingSettings(ctx)
  const installAt = Date.now()

  // 首条 base 快照：内置价表 + 默认汇率，同时充当「安装前历史」的回填口径（spec §5.6）。
  const snapshots = domain.table('snapshots')
  if (snapshots.size === 0) {
    const base = planSnapshot(undefined,
      { entries: { ...BUILTIN_CATALOG }, usdToCny: DEFAULT_USD_TO_CNY, usdToCnySource: 'default' },
      { id: 'snap-install', at: installAt, reason: 'install' })
    if (base !== null) await snapshots.put(base.id, base)
    // 价表写入必须让聚合 TTL 缓存失效（同一进程内重新装配时缓存还留着上一张表）。
    resetAggregateCache()
  }

  // sessionQuery 是可选依赖：它未装配时聚合退化为「空会话集」，不抛。
  const source: SessionSource = {
    listSessions: async () => {
      const q = ctx.get('sessionQuery') as SessionQueryLike | undefined
      if (q === undefined) return []
      return (await q.listSessions()).map((r) => ({ header: r.header }))
    },
    listEvents: async (id: string) => {
      const q = ctx.get('sessionQuery') as SessionQueryLike | undefined
      if (q === undefined) return []
      return await q.listEvents(id as never)
    },
    readSession: async (id: string) => {
      const q = ctx.get('sessionQuery') as SessionQueryLike | undefined
      if (q === undefined) throw new Error('sessionQuery unavailable')
      const snap = await q.readSession(id as never)
      return { session: snap.session, events: [...snap.events] }
    },
  }

  const service = new UsageBillingService(ctx, {
    domain,
    settings,
    installAt,
    source,
    fetchPricing: async () => {
      const web = ctx.get('web')
      if (web === undefined) return { ok: false, reason: 'web 服务未装配' }
      return await fetchPricingFromNetwork({ web, snapshots, installAt, now: () => Date.now() })
    },
  })
  void service

  // 后台预热 + 定时刷新（timer 与 disposer 都归属当前 fiber）。
  ctx.effect(() => {
    void aggregateOnce({
      source,
      ledger: domain.table('ledger'),
      folds: domain.table('folds'),
      diag: domain.table('diag'),
      aliases: domain.table('aliases'),
      snapshots,
      installAt,
    }).catch((error: unknown) => {
      ctx.logger.warn('[plugin-usage-billing] 预热聚合失败：', error)
    })

    const timer = setInterval(() => {
      const cfg = settings.get()
      if (!cfg.pricing.autoRefresh) return
      void service.refreshPricing(false).catch(() => {})
    }, REFRESH_CHECK_MS)
    return () => clearInterval(timer)
  })
}
