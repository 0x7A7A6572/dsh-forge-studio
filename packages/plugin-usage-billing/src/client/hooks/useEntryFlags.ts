/**
 * 入口开关：订阅宿主设置快照，两个入口组件各自判断自己该不该渲染。
 *
 * 两个槽位都常驻注册，谁渲染由这里收敛；不按设置重新注册槽位 —— 注册回调只跑一次，
 * 反注册再注册会把 already-injected 的槽位状态搅乱（宿主侧 slots 的注入是声明式的）。
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { BillingScope } from '../core/config.ts'
import { entryFlagsOf } from '../core/config.ts'
import type { EntryKey } from '../../types.ts'

/** 只返回布尔：useSyncExternalStore 要求快照引用稳定，对象得另做缓存，不值得。 */
export function useEntryVisible(scope: BillingScope, key: EntryKey): boolean {
  return useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => entryFlagsOf(scope.getSnapshot().value)[key],
  )
}
