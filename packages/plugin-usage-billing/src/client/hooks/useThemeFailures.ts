/**
 * 订阅主题装载失败列表。
 *
 * 与 `useThemes` 同一个姿态：store 的两个方法都是闭包实现，`list()` 返回缓存快照，
 * 所以可以直接交给 `useSyncExternalStore`。
 */
import { useSyncExternalStore } from 'react'
import type { ThemeFailure, ThemeFailureStore } from '../core/themes/failures.ts'

export function useThemeFailures(store: ThemeFailureStore): readonly ThemeFailure[] {
  return useSyncExternalStore(store.subscribe, store.list)
}
