/**
 * 四态合成与动画帧推进（§5.4/§5.5）：纯函数，Node 可单测。
 */
import type {
  StudioAnimationClip,
  StudioStateMapping,
  StudioVisualState,
} from './scene-types.ts'
import { BUILTIN_STATE_MAPPING, STUDIO_DONE_HOLD_MS, STUDIO_TICK_FPS } from './scene-types.ts'

/** 投影里的成员 phase（TeamMemberProjection）。 */
export type StudioMemberPhase = 'active' | 'provisioning' | 'failed'

/** 一次合成的输入：phase + running（官方同款，undefined 时回退）。 */
export interface StudioMemberRuntime {
  readonly phase: StudioMemberPhase
  readonly running?: boolean
}

/** 上一帧的视觉状态与 done 窗口（推进 done 边沿用）。 */
export interface StudioVisualMemo {
  readonly visual: StudioVisualState
  readonly doneUntil?: number
}

/** 直映射（§5.5），目标取自场景的 states 映射，不硬编码。 */
export function resolveVisualState(
  runtime: StudioMemberRuntime,
  states: StudioStateMapping = BUILTIN_STATE_MAPPING,
): StudioVisualState {
  if (runtime.phase === 'failed') return states.failed
  if (runtime.phase === 'provisioning') return states.provisioning
  return runtime.running === true ? states.running : states.inactive
}

/**
 * 带优先级的推进：done 是 active 成员 running→非 running 的边沿（一次性窗口）。
 * 窗口内收到 failed/provisioning/running 立即让位；窗口到期回落 inactive 映射。
 */
export function advanceVisualState(
  prev: StudioVisualMemo,
  next: StudioMemberRuntime,
  now: number,
  states: StudioStateMapping = BUILTIN_STATE_MAPPING,
  holdMs: number = STUDIO_DONE_HOLD_MS,
): StudioVisualMemo {
  if (next.phase !== 'active') {
    return { visual: resolveVisualState(next, states) }
  }
  if (next.running === true) {
    return { visual: states.running }
  }
  const edge = prev.visual === states.running
  const inWindow = prev.visual === states.done && (prev.doneUntil ?? 0) > now
  if (edge || inWindow) {
    return { visual: states.done, doneUntil: edge ? now + holdMs : prev.doneUntil }
  }
  return { visual: states.inactive }
}

/**
 * 经过 tick → clip 帧号，纯整数运算 floor(ticks*fps/12)，避免浮点累积偏帧。
 * 循环 clip 取模；非循环钳在末帧（error 停 f3、done 停 f7 等播完态）。
 */
export function clipFrameIndex(clip: StudioAnimationClip, elapsedTicks: number): number {
  const frame = Math.floor((Math.max(0, elapsedTicks) * clip.fps) / STUDIO_TICK_FPS)
  return clip.loop ? frame % clip.frameCount : Math.min(frame, clip.frameCount - 1)
}
