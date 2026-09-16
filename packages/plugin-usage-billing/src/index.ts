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
import type { SessionSource } from './aggregate.ts'
import { BUILTIN_CATALOG, DEFAULT_USD_TO_CNY } from './pricing/catalog.ts'
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
  readSession(id: string): Promise<{ session: SessionHeader; events: SessionEvent[] }>
}

/**
 * sessionPersistence 服务的最小视图：一次 `list()` 就给全每个会话的 header 与**变更戳**
 * （后端用文件的 stat 身份生成，不读会话正文）。这是"这个会话变过没有"的便宜判据，
 * 也是这套聚合能从分钟级降到毫秒级的关键。
 */
interface SessionPersistenceLike {
  list(options?: { signal?: AbortSignal }): Promise<readonly { header: SessionHeader; revision: string }[]>
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
  /**
   * 估算起点的时刻：**每次 apply 现取**，即「本次宿主加载该服务」的时间，不持久化。
   * 它只用于 `ensureBaseSnapshot` 那一刻的落盘（此后由 ledger 里 `reason: 'install'` 的
   * 快照自己留存），因此宿主重启后 `status()` 报的是本次加载时刻，不是当初首次安装的时刻 ——
   * 界面文案按这个口径措辞（`client/views/backfill-notice.tsx`）。
   */
  const installAt = Date.now()

  // 首条 base 快照由 service.ensureBaseSnapshot 写（安装基准只有这一份实现）：
  // 它的判据是「账本里没有 install 层」，而不是「表是空的」——先落过自定义价 /
  // 刷新记录的账本，安装基准同样必须补上。
  const snapshots = domain.table('snapshots')

  // sessionPersistence / sessionQuery 都是可选依赖：都没装配时聚合退化为「空会话集」，不抛。
  const source: SessionSource = {
    listSessions: async () => {
      const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
      if (persistence !== undefined) {
        const listed = await persistence.list()
        return listed.map((s) => ({ header: s.header, stamp: String(s.revision) }))
      }
      // 退化路径：拿不到变更戳就只能列头部，那一轮每个会话都会整会话重读（慢但正确）。
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

  // 内置价表 + 默认汇率，同时充当「安装前历史」的回填口径（spec §5.6）。
  await service.ensureBaseSnapshot({ ...BUILTIN_CATALOG }, DEFAULT_USD_TO_CNY, 'default')

  // 后台预热 + 定时刷新（timer 与 disposer 都归属当前 fiber）。
  ctx.effect(() => {
    // 预热与读端点走**同一条合并通道**：用户此刻点开面板不会再另起一趟全量扫描。
    //
    // 预热之后再补一趟「未计价行重算」：价格规则升级（例如新增同名兜底）之前落下的
    // 未计价行不会自己变成已计价 —— 而那些行正是用户盯着的金额（经中转渠道调的官方模型
    // 全部显示「未收录」）。repricing 是 spec §5.7 的唯一例外通道，只碰 unpriced 行，
    // 已锁定的行绝不改写；它不在读路径上，失败只记日志。稳态下这一趟找不到任何
    // 可重算的行，等于一次空扫。
    void service.warmup()
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
      // 整个 tick 都在 guard 内：settings.get() 同步抛（provider 坏掉）也不能逃出
      // 定时器回调变成 uncaught exception。
      try {
        const cfg = settings.get()
        if (!cfg.pricing.autoRefresh) return
        // 刷新失败有两条路：Promise 拒绝，以及 `{ ok: false, reason }` 的正常返回。
        // 两条都必须落日志（与预热路径同一个 logger），否则「后台一直没刷新」毫无痕迹。
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
