/**
 * 显示开关：订阅宿主设置快照，两个入口组件各自判断自己该不该渲染、弹窗里该不该画峰谷图。
 *
 * 两个槽位都常驻注册，谁渲染由这里收敛；不按设置重新注册槽位 —— 注册回调只跑一次，
 * 反注册再注册会把 already-injected 的槽位状态搅乱（宿主侧 slots 的注入是声明式的）。
 */
import { useCallback, useSyncExternalStore } from 'react'
import { BUILTIN_THEME_ID } from '../../shape/index.ts'
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

/**
 * 峰谷时段图开关。判据是 `!== false` 而不是真值判断：字段缺席（旧 host、还没写过设置）
 * 与显式 `true` 同解，都按**默认开**处理，与 settings.ts 的 base 默认对齐。
 */
export function useShowTierCurve(scope: BillingScope): boolean {
  return useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot().value?.display?.showTierCurve !== false,
  )
}

/**
 * 侧栏选了哪个形状。
 *
 * 缺省（旧 host、还没写过设置）回落到内置那条 id。**这里不校验它是否存在** ——
 * 插件被停用 / 卸载是常态，兜底交给 `selectTierShape`（找不到就回落内置），
 * 两处都判就会有两套口径。
 */
export function useTierShapeId(scope: BillingScope): string {
  return useSyncExternalStore(
    useCallback((notify: () => void) => scope.subscribe(notify), [scope]),
    () => scope.getSnapshot().value?.display?.tierShape ?? BUILTIN_THEME_ID,
  )
}
