/**
 * 订阅主题集合。
 *
 * 直接把 `registry.subscribe` / `registry.list` 交给 useSyncExternalStore —— 可行是因为
 * 注册表的两个方法都是闭包实现的（不依赖 `this`），而且 `list()` 返回的是**缓存快照**
 * （见 core/theme-registry.ts）：引用在数据没变时稳定，否则每次读都是一个新数组，
 * useSyncExternalStore 会自激成无限重渲染。
 */
import { useSyncExternalStore } from 'react'
import type { Theme } from '../../shape/index.ts'
import type { ThemeRegistry } from '../core/theme-registry.ts'

/** 当前注册在册的全部主题，按注册顺序。主题集合变化时组件重渲染。 */
export function useThemes(registry: ThemeRegistry): readonly Theme[] {
  return useSyncExternalStore(registry.subscribe, registry.list)
}
