/**
 * 主题装载失败列表。
 *
 * 为什么要一个 store 而不是往 registry 里塞：失败的主题**不该**出现在设置页下拉里
 * （选它就等于选一个画不出来的东西），但它必须**可见** —— 用户放了个文件却没生效，
 * 唯一能告诉他"为什么"的地方就是这里。
 *
 * 按 id 去重（同 id 后写的顶掉先写的）：重复装载不该把列表堆成一串。
 *
 * 列表里的每一条都必须是**当下还成立**的故障。所以除了 `add` 还有 `clear`：同一个 id 在这一次
 * 会话里后来装成功了，先前那条失败就过期了 —— 不清掉的话，设置页会一直指着一个能用的主题说
 * 「它为什么没生效」，比不报更糟。
 */

/** 清单本身拉不到时的哨兵 id。括号让它不可能与真实主题 id（`[a-z0-9-]`）撞上。 */
export const THEME_MANIFEST_FAILURE_ID = '(manifest)'

export interface ThemeFailure {
  readonly id: string
  readonly reason: string
}

export interface ThemeFailureStore {
  add(failure: ThemeFailure): void
  /** 这个 id 已经成功了：把它的失败行撤掉（没有就什么也不做，也不通知）。 */
  clear(id: string): void
  list(): readonly ThemeFailure[]
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createThemeFailureStore(): ThemeFailureStore {
  const rows = new Map<string, ThemeFailure>()
  const listeners = new Set<() => void>()
  let snapshot: readonly ThemeFailure[] = []

  const emit = (): void => {
    snapshot = [...rows.values()]
    for (const listener of listeners) listener()
  }

  return {
    add(failure) {
      rows.set(failure.id, failure)
      emit()
    },
    clear(id) {
      // 没有这一条就**不**emit：订阅者（`useSyncExternalStore`）每收到一次通知就重渲染一次，
      // 空清一次也是白渲染。顺便保住「快照只在真的变了之后才换引用」这条约定。
      if (!rows.delete(id)) return
      emit()
    },
    list: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      rows.clear()
      // 先 emit 再丢监听者：拆掉 store 也是一次「数据变了」（列表变空）。订阅者若还挂在界面上，
      // 不叫醒它就会一直显示一批已经不存在的失败；叫完再清监听者，因为此后没有下一个快照了。
      emit()
      listeners.clear()
    },
  }
}
