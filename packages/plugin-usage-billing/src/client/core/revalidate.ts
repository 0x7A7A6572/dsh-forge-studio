/**
 * 用量数据的自动重取心跳：可见时 60s 一拍，两拍之间至少隔 30s，切回前台立即补一拍。
 *
 * 为什么是**共享心跳**而不是每个视图各起一个定时器：两个入口与设置页的用量视图会同时挂载，
 * 各自定时等于同一秒里三四个定时器各发两三个请求。心跳只吐一个递增的 revision，视图把它
 * 加进 effect 依赖 —— 谁在挂载谁跟着重取；同一拍里重复的请求由 core/query.ts 合并掉。
 *
 * 隐藏时一拍都不发（连已经排队的尾沿也在转后台时丢掉），回到前台立即补一拍：
 * 后台标签页既看不到数字，也没理由让 host 反复折叠账本。
 *
 * 心跳的职责只有「让界面再问一次」：账本折叠、金额计算、口径判断全在 host 现算，
 * 客户端不缓存也不推算任何数。节流的意义是兜住 visibilitychange 抖动与参数连环变化，
 * 间隔内的 bump 合并到下一个可发点（不丢拍）。
 */

/** 可见时的节拍。 */
export const REVALIDATE_TICK_MS = 60_000

/** 两次重取之间的最小间隔。 */
export const REVALIDATE_MIN_GAP_MS = 30_000

/**
 * 心跳需要的 document 最小面。写成松签名（type: string + 无参 listener）是为了让真
 * `document` 直接结构化传入，同时测试能塞一个几十行的假实现，不必伪造整个 Document。
 */
export interface VisibilitySource {
  readonly hidden: boolean
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export interface Revalidator {
  /** 稳定引用，可直接喂 useSyncExternalStore。 */
  subscribe(listener: () => void): () => void
  /** 稳定引用；返回值变化即代表「该重取一次」。 */
  getRevision(): number
  dispose(): void
}

export interface RevalidatorOptions {
  tickMs?: number
  minGapMs?: number
  /** 缺省（无 DOM 环境）时只保留手动触发，不装定时器也不听可见性。 */
  source?: VisibilitySource | undefined
  now?: () => number
}

export function createRevalidator(options: RevalidatorOptions = {}): Revalidator {
  const tickMs = options.tickMs ?? REVALIDATE_TICK_MS
  const minGapMs = options.minGapMs ?? REVALIDATE_MIN_GAP_MS
  const source = options.source
  const now = options.now ?? (() => Date.now())

  const listeners = new Set<() => void>()
  let revision = 0
  // 初值 -Infinity：第一拍不受最小间隔约束（首拍就是「现在就发」）。
  let lastAt = Number.NEGATIVE_INFINITY
  let trailing: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const emit = (): void => {
    // 隐藏时一律不拍：拍子由 tick 与可见性两条路进来，这里是唯一的出口。
    if (disposed || source?.hidden === true) return
    revision += 1
    lastAt = now()
    // 复制一份再遍历：监听器在回调里退订不会让这一轮漏人。
    for (const listener of [...listeners]) listener()
  }

  const bump = (): void => {
    if (disposed) return
    // 已经排了尾沿 = 这一轮已经有人拍过，直接并入，不再排队。
    if (trailing !== undefined) return
    const gap = now() - lastAt
    if (gap >= minGapMs) { emit(); return }
    trailing = setTimeout(() => { trailing = undefined; emit() }, minGapMs - gap)
  }

  const ticker = setInterval(() => {
    if (source?.hidden === true) return
    bump()
  }, tickMs)

  const onVisibilityChange = (): void => {
    if (source?.hidden === true) {
      // 转后台：丢掉还没发的尾沿（它代表的是一次没人看得见的刷新），回到前台重新拍。
      if (trailing !== undefined) { clearTimeout(trailing); trailing = undefined }
      return
    }
    bump()
  }
  source?.addEventListener('visibilitychange', onVisibilityChange)

  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getRevision() { return revision },
    dispose() {
      disposed = true
      clearInterval(ticker)
      if (trailing !== undefined) { clearTimeout(trailing); trailing = undefined }
      source?.removeEventListener('visibilitychange', onVisibilityChange)
      listeners.clear()
    },
  }
}
