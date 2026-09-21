/**
 * 订阅自动重取心跳。返回值变化 = 该重取一次；视图只把它加进 effect 依赖，
 * 不自己起定时器（心跳在 core/revalidate.ts 里唯一）。
 */
import { useSyncExternalStore } from 'react'
import type { Revalidator } from '../core/revalidate.ts'

export function useRevision(revalidate: Revalidator): number {
  return useSyncExternalStore(revalidate.subscribe, revalidate.getRevision)
}
