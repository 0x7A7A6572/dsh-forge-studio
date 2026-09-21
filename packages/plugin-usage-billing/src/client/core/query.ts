/**
 * 同一拍的请求合并：相同 key 的并发调用共享一个 in-flight Promise，落地即删。
 *
 * 为什么需要：侧栏与输入框下方两个入口都要 overview('month') + byWorkspace('month')，
 * 自动重取一拍会把同一份数据要两遍（设置页开着时 overview 还要被第三个视图再要一次）。
 *
 * 只合并**并发**调用、不留任何缓存：下一拍仍然真取数，新鲜度语义一个字不变 ——
 * 合并窗口就是一个往返（本机毫秒级），所以「写完之后 reload 拿到旧响应」的窗口可以忽略。
 *
 * key 一律由本模块的构造器产出：调用点各拼各的字符串，拼错的那一处只会静默地不合并不报错。
 */

import type { RangeKind } from '../../time.ts'

export interface QueryCache {
  /** 相同 key 的并发调用只跑一次 `load`；失败与成功都如实透传给每一个调用方。 */
  run<T>(key: string, load: () => Promise<T>): Promise<T>
}

/** 账本快照类端点的 key：参数全列进 key，参数不同的调用绝不互相顶掉。 */
const key = (method: string, range: RangeKind, includeSubagents: boolean): string =>
  `${method}:${range}:${includeSubagents}`

export const overviewKey = (range: RangeKind, includeSubagents: boolean): string =>
  key('overview', range, includeSubagents)

export const dailyKey = (range: RangeKind, includeSubagents: boolean): string =>
  key('daily', range, includeSubagents)

export const byModelKey = (range: RangeKind, includeSubagents: boolean): string =>
  key('byModel', range, includeSubagents)

export const byWorkspaceKey = (range: RangeKind, includeSubagents: boolean): string =>
  key('byWorkspace', range, includeSubagents)

export function createQueryCache(): QueryCache {
  const inflight = new Map<string, Promise<unknown>>()
  return {
    run<T>(key_: string, load: () => Promise<T>): Promise<T> {
      const hit = inflight.get(key_)
      if (hit !== undefined) return hit as Promise<T>
      const started = load()
      inflight.set(key_, started)
      // 失败也必须摘掉：留着一个已 reject 的 Promise 会让这一拍后面的同类调用
      // 拿到一份永远不会变的失败结果，界面上就成了「一直读不出来」。
      const clear = (): void => { if (inflight.get(key_) === started) inflight.delete(key_) }
      void started.then(clear, clear)
      return started
    },
  }
}
