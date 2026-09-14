/**
 * 编辑中自动保存的调度器（纯逻辑，不依赖 React，便于单测）。
 *
 * 规则：
 * - `touch()`：记一次改动 → 延迟 `delayMs` 落盘；重复调用 = **重置倒计时**
 *   （否则会边打字边写库）；
 * - 落盘是异步的：保存期间又到期 → 记一笔「待补」，本次结束后隔 `retryMs` 再跑
 *   —— 草稿在每次 `save()` 里现取，所以补跑一定写的是**最新**内容，不会覆盖成旧值；
 * - `cancel()`：清掉未触发的定时器（Ctrl+S 立即保存前先取消，避免刚落盘又跑一次）；
 * - `dispose()`：卸载清理（在途保存结束后不再重排）。
 *
 * 之所以独立成模块：自动保存的时序（防抖 / 在途补跑 / 取消）是这块最容易出错的逻辑，
 * 抽出来可以用假定时器逐条锁定，组件里只剩「改动 → touch()」。
 */

export interface AutoSaver {
  /** 记一次改动：延迟落盘（重复调用重置倒计时）。 */
  touch(): void
  /** 清掉未触发的定时器，且不再补跑（立即保存前调用）。 */
  cancel(): void
  /** 卸载清理：清定时器，在途保存结束后也不再重排。 */
  dispose(): void
  /** 当前是否有待触发的定时器（测试/调试用）。 */
  readonly pending: boolean
}

export interface AutoSaverOptions {
  /** 改动后静置多久落盘。 */
  readonly delayMs: number
  /** 撞上在途保存时的补跑间隔。 */
  readonly retryMs: number
  /** 真正落盘：每次调用都应读取**当时**的最新草稿。 */
  readonly save: () => Promise<void>
}

export function createAutoSaver(options: AutoSaverOptions): AutoSaver {
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let queued = false
  let disposed = false

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (delayMs: number): void => {
    if (disposed) return
    clear()
    timer = setTimeout(() => {
      timer = null
      void run()
    }, delayMs)
  }

  const run = async (): Promise<void> => {
    if (disposed) return
    if (inFlight) {
      // 在途保存还没回来：记一笔，等它结束再补跑（内容届时现取，不会写旧草稿）。
      queued = true
      return
    }
    inFlight = true
    try {
      await options.save()
    } finally {
      inFlight = false
      if (queued) {
        queued = false
        schedule(options.retryMs)
      }
    }
  }

  return {
    touch: () => schedule(options.delayMs),
    cancel: () => {
      queued = false
      clear()
    },
    dispose: () => {
      disposed = true
      queued = false
      clear()
    },
    get pending() {
      return timer !== null
    },
  }
}
