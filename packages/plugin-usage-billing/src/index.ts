import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { usageBillingDomain } from './domain.ts'
import { UsageBillingService } from './service.ts'
import { installUsageBillingSettings, configureUsageBillingSettingsPage, type Config } from './settings.ts'
import type { SessionSource } from './aggregate.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from './pricing/catalog.ts'
import { fetchPricingFromNetwork } from './pricing/fetch.ts'
import { createThemeTranspiler } from './themes/transpile.ts'
import { installThemesRoute } from './themes/route.ts'
import { resolveThemesRoot } from './themes/discover.ts'

export const name = '@zzerx/dsh-plugin-usage-billing'
export const inject = ['storageDomain']
/** 设置分区的命名空间就是本条目 id。 */
export { Config } from './settings.ts'

const REFRESH_CHECK_MS = 60_000

interface SessionQueryLike {
  listSessions(): Promise<Array<{ header: SessionHeader }>>
  readSession(id: string): Promise<{ session: SessionHeader; events: SessionEvent[] }>
}

/** revision 由文件 stat 身份生成，不读会话正文。 */
interface SessionPersistenceLike {
  list(options?: { signal?: AbortSignal }): Promise<readonly { header: SessionHeader; revision: string }[]>
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const domainService = ctx.get('storageDomain')
  if (domainService === undefined) {
    ctx.logger.warn('[plugin-usage-billing] storageDomain 未装配，计费聚合不可用（插件已降级）')
    return
  }

  const domain = await domainService.open(usageBillingDomain)
  ctx.effect(() => () => { void domain.close() })

  const settings = installUsageBillingSettings(ctx, config)
  // webServer 不进顶层 inject：那样激活就依赖 WebServer；交给 ctx.inject 后服务后到也会补挂。
  // 转译器只建一个：缓存挂在实例上。
  const disposeThemes = installThemesRoute(ctx, {
    root: resolveThemesRoot(),
    transpiler: createThemeTranspiler(),
  })
  ctx.effect(() => () => { disposeThemes() })
  configureUsageBillingSettingsPage(ctx)
  /** 本次加载时刻，非首次安装时刻：之后由 `reason: 'install'` 的快照留存。 */
  const installAt = Date.now()

  // 判据是「账本里没有 install 层」，不是「表是空的」。
  const snapshots = domain.table('snapshots')

  const source: SessionSource = {
    listSessions: async () => {
      const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
      if (persistence !== undefined) {
        const listed = await persistence.list()
        return listed.map((s) => ({ header: s.header, stamp: String(s.revision) }))
      }
      // 退化：stamp 为 null，该轮每个会话整会话重读。
      const q = ctx.get('sessionQuery') as SessionQueryLike | undefined
      if (q === undefined) return []
      return (await q.listSessions()).map((r) => ({ header: r.header, stamp: null }))
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
    fetchPricing: async ({ force, ttlHours }) => {
      const web = ctx.get('web')
      if (web === undefined) return { ok: false, reason: 'web 服务未装配' }
      return await fetchPricingFromNetwork({ web, snapshots, now: () => Date.now() }, force, ttlHours)
    },
  })

  // 同时充当「安装前历史」的回填口径。
  await service.ensureBaseSnapshot({ ...BUILTIN_CATALOG }, DEFAULT_USD_TO_CNY, 'default')

  // 预热与定时刷新的 timer / disposer 都归属当前 fiber。
  ctx.effect(() => {
    // 预热与读端点共用同一条合并通道，不另起一趟全量扫描。
    // repricing 只碰 unpriced 行，已锁定的行不改写。
    // 首启或上次重建未收尾时先整语料重折：旧水位指向旧容器。
    const preheat = domain.global.get().rebuiltAt === undefined
      ? service.rebuildLedger().then((stats) => {
        if (stats.failures > 0) {
          // 不落标记：失败会话水位未推进，下次启动整趟重来。
          ctx.logger.warn(`[plugin-usage-billing] 账本分片重建有 ${stats.failures} 个会话失败，下次启动重来`)
        } else {
          ctx.logger.info(`[plugin-usage-billing] 账本分片重建完成：${stats.rows} 行 / ${domain.table('ledger_shards').size} 个分片`)
        }
      })
      : service.warmup()

    void preheat
      .then(() => service.repricing())
      .then((result) => {
        if (result.changed > 0) {
          ctx.logger.info(`[plugin-usage-billing] 启动重算：${result.changed} 行未计价记录已按现价表补价`)
        }
      })
      .catch((error: unknown) => {
        ctx.logger.warn('[plugin-usage-billing] 预热聚合失败：', error)
      })

    const timer = setInterval(() => {
      try {
        const cfg = settings.get()
        if (!cfg.pricing.autoRefresh) return
        // 失败有两种：Promise 拒绝、{ ok: false } 返回，两条都要落日志。
        void service.refreshPricing(false)
          .then((result) => {
            if (!result.ok) ctx.logger.warn('[plugin-usage-billing] 后台刷新失败：', result.reason)
          })
          .catch((error: unknown) => {
            ctx.logger.warn('[plugin-usage-billing] 后台刷新异常：', error)
          })
      } catch (error) {
        ctx.logger.warn('[plugin-usage-billing] 刷新调度失败：', error)
      }
    }, REFRESH_CHECK_MS)
    return () => clearInterval(timer)
  })
}
