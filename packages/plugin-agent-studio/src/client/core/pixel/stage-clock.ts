/**
 * 12fps tick 量化（§5.1/§6.5）：纯函数，掉帧不补帧。
 */
import { STUDIO_TICK_FPS } from './scene-types.ts'

/** 单帧毫秒（1000/12 ≈ 83.33）。 */
export const STUDIO_FRAME_MS = 1000 / STUDIO_TICK_FPS

/** 量化一帧：距上次推进不足一帧则不动；落后超过一帧也只推 1 tick（不补帧）。 */
export function advanceTick(
  tick: number,
  nowMs: number,
  lastMs: number,
): { tick: number; lastMs: number; due: boolean } {
  if (nowMs - lastMs < STUDIO_FRAME_MS) {
    return { tick, lastMs, due: false }
  }
  return { tick: tick + 1, lastMs: nowMs, due: true }
}
