/**
 * 便签侧栏「活动待办」计数（侧栏入口徽标）——模块级 store + **事件驱动**刷新。
 *
 * 数据流（全部由事件触发，无定时轮询）：
 * - 便签板**打开时**：board-view 每次 refresh（操作后/变更推送/手动刷新）都 sync
 *   最新列表，徽标随板内即时更新 —— 本模块的变更订阅跳过（板内已拉取，避免双份）；
 * - 便签板**关着时**：宿主 notes/watch 推送（agent 工具/WebDAV 恢复等外部写）到达
 *   变更总线后，这里拉一次 notes.list() 同步徽标（挂载后先刷一次，不等事件）；
 * - 快捷新建浮层保存成功后：显式调 refreshNotesStats() 立即补一次（等推送会滞后）。
 *
 * 计数口径见 task-lanes.countOpenTasks（未归档且泳道 ∈ {待办,进行中}）。
 * store 与 boardStore 同为模块级单例（同范式）。
 */

import type { NoteRecord } from '../../types.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { boardStore } from './board-store.ts'
import { countOpenTasks } from './task-lanes.ts'
import type { NotesRemote } from './notes-remote.ts'

type Listener = () => void

/** list 远程调用签名（notes.list，窄化到本模块所需）。 */
export type NotesStatsList = () => Promise<RemoteResult<readonly NoteRecord[]>>

let openTasks = 0
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * 徽标小签内文：>0 显示「待办 N」（99+ 封顶，防撑坏行宽）；≤0 返回空串
 * （调用方直接隐藏小签）。
 */
export function openTaskText(count: number): string {
  if (count <= 0) return ''
  return '待办 ' + (count > 99 ? '99+' : count)
}

export const notesStatsStore = {
  get openTasks(): number {
    return openTasks
  },
  /** 用整份便签列表同步计数（board-view 每轮 refresh 调用；无变化不发事件）。 */
  sync(notes: readonly NoteRecord[]): void {
    const next = countOpenTasks(notes)
    if (next === openTasks) return
    openTasks = next
    emit()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** 模块级「便签已变更」事件总线：宿主 notes/watch 推送事件 → 各 UI 面各自刷新。 */
const changeListeners = new Set<Listener>()

export const notesChangeBus = {
  /** 订阅一次变更通知；返回退订函数。 */
  subscribe(listener: Listener): () => void {
    changeListeners.add(listener)
    return () => {
      changeListeners.delete(listener)
    }
  },
  /** 广播一次变更（watch 推送循环调用；订阅者抛错不扩散）。 */
  notify(): void {
    for (const listener of [...changeListeners]) listener()
  },
}

/** 当前生效的 list 调用（mountNotesStats 注入；供手动补刷）。 */
let activeList: NotesStatsList | undefined
let mounted = false

/** 徽标拉取合并：并发请求折叠成一次，忙时只记一个待补。 */
let fetching = false
let refetchQueued = false

async function runListOnce(): Promise<void> {
  if (activeList === undefined) return
  try {
    const result = await activeList()
    if (result.ok) notesStatsStore.sync(result.value)
  } catch {
    // 瞬时错误忽略：下一次事件/手动补刷自然重试，不炸侧栏。
  }
}

function requestBadgeRefresh(): void {
  if (fetching) {
    refetchQueued = true
    return
  }
  fetching = true
  void runListOnce()
    .catch(() => undefined)
    .finally(() => {
      fetching = false
      if (refetchQueued) {
        refetchQueued = false
        requestBadgeRefresh()
      }
    })
}

/**
 * 启动徽标（模块级幂等：重复 apply / HMR 只挂一轮，旧轮由旧 fiber 的 disposer
 * 收掉）。node 环境（无 window）no-op，便于单测 import。
 * 职责收窄为：注入 list 通道 + 首刷一次 + 订阅变更总线（关板时兜底徽标）。
 * @returns 停止订阅与刷新的 disposer。
 */
export function mountNotesStats(list: NotesStatsList): () => void {
  if (typeof window === 'undefined' || mounted) return () => {}
  mounted = true
  activeList = list

  // 首刷：页面加载后徽标不必等事件即可显示真实计数。
  requestBadgeRefresh()

  const unsubscribe = notesChangeBus.subscribe(() => {
    // 便签板挂载中时 board-view 的刷新已在同步，跳过避免双份拉取。
    if (boardStore.mounted) return
    requestBadgeRefresh()
  })

  return () => {
    unsubscribe()
    mounted = false
    activeList = undefined
  }
}

/**
 * 手动补刷一次计数（例：快捷新建浮层保存成功后立即反映到徽标；
 * 未挂载时 no-op）。
 */
export async function refreshNotesStats(): Promise<void> {
  if (activeList === undefined) return
  await runListOnce()
}

/**
 * 订阅宿主 notes/watch 变更推送流（事件驱动核心）：每收到一个事件就广播到
 * notesChangeBus。断开自动重连（带退避），disposer 中止并收尾。
 * 模块级幂等；node 环境（无 window）no-op。
 * @returns 停止订阅的 disposer。
 */
export function mountNotesChangeWatch(notes: NotesRemote): () => void {
  if (typeof window === 'undefined' || watchMounted) return () => {}
  watchMounted = true
  const controller = new AbortController()
  let disposed = false

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  const run = async (): Promise<void> => {
    while (!disposed && !controller.signal.aborted) {
      try {
        for await (const _change of notes.watch(controller.signal)) {
          if (disposed || controller.signal.aborted) break
          notesChangeBus.notify()
        }
      } catch {
        // 载波断连/瞬时错误：退避后重连（事件驱动同样需要自愈）。
      }
      if (disposed || controller.signal.aborted) break
      await sleep(2_000)
    }
  }
  void run()

  return () => {
    disposed = true
    controller.abort()
    watchMounted = false
  }
}

let watchMounted = false
