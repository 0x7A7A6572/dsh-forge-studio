/**
 * 主题集合：宿主内部集合，用户主题由 `/usage-billing/themes` 装载。
 *
 * 不再是 cordis 服务 —— 契约收进本包的 `./shape` 子路径之后，主题是磁盘上的一个文件，
 * 不需要跨插件注册，也就不需要服务名与 module augmentation。宿主自己装内置那张，
 * 装载器随后把用户主题补进来；谁渲染由宿主决定。
 */
import type { Theme } from '../../shape/index.ts'

/** 主题集合：宿主内部用，不再是 cordis 服务。 */
export interface ThemeRegistry {
  register(theme: Theme): () => void
  list(): readonly Theme[]
  subscribe(listener: () => void): () => void
}

/** 宿主内部多一个整表注销：插件卸载时不必逐个调用 disposer。 */
export interface ThemeRegistryHandle extends ThemeRegistry {
  /** 清空全部主题与订阅（宿主 client 插件卸载时调用）。 */
  dispose(): void
}

/**
 * 建一张注册表。
 *
 * `list()` 返回一份**缓存快照**而不是每次现算：它会直接喂给 React 的
 * `useSyncExternalStore`，而那个 API 要求 getSnapshot 在数据没变时返回同一个引用，
 * 否则每次读都是一个新数组 → 无限重渲染。
 */
export function createTierShapeRegistry(): ThemeRegistryHandle {
  /** id → 主题。同 id 后注册的**顶掉**先注册的：热改同一个主题不必先注销再注册。 */
  const shapes = new Map<string, Theme>()
  const listeners = new Set<() => void>()
  let snapshot: readonly Theme[] = []

  const emit = (): void => {
    snapshot = [...shapes.values()]
    for (const listener of listeners) listener()
  }

  return {
    register(shape) {
      shapes.set(shape.id, shape)
      emit()
      return () => {
        // 只在「这一格还是我」时删：被同 id 的后注册者顶掉之后，
        // 旧 disposer 不该把新的那份删掉（HMR 下这个顺序是常态）。
        if (shapes.get(shape.id) !== shape) return
        shapes.delete(shape.id)
        emit()
      }
    },
    list: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      shapes.clear()
      listeners.clear()
      snapshot = []
    },
  }
}
