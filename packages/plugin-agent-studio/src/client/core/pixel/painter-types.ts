/**
 * 绘制层共享类型：canvas 别名、每帧绘制参数与帧计划（无 react、无绘制逻辑）。
 */
import type { AtlasBitmap, DecodedAtlas } from './atlas.ts'
import type { StagePalette } from './stage-tokens.ts'
import type { StudioOccupant } from './scene-types.ts'

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
export type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface StageAssets {
  bg?: AtlasBitmap
  charsDecoded?: DecodedAtlas
}

export interface StageCaches {
  /** 角色 LUT 变体画布，键 `${themeKey}:${entry}:${accent}`。 */
  readonly variant: Map<string, AnyCanvas>
  /** fallback 精灵画布，键含像素内容与主题。 */
  readonly fallback: Map<string, AnyCanvas>
  /** 各成员视觉状态变化的 tick（clip 重放用）。 */
  readonly tickStart: Map<string, number>
  /** 已合成的静态层画布（场景画布 2×）。 */
  staticLayer?: AnyCanvas
}

export interface StageDrawOpts {
  readonly tick: number
  readonly now: number
  readonly themeKey: string
  readonly palette: StagePalette
  readonly assets: StageAssets
  readonly reducedMotion: boolean
  readonly caches: StageCaches
}

/** 帧几何快照（调试叠层用；渲染本体不读）。 */
export interface PlannedCharacterDebug {
  readonly frameIndex: number
  readonly atSeat: boolean
  readonly sitting: boolean
  readonly facing: 'left' | 'right'
  readonly flip: boolean
  readonly sitShift: number
  readonly footX: number
  readonly footY: number
}

/** L2 计划项：角色绘制位置与整体 alpha（done 淡出）。 */
/** 角色姿态帧：静止 / 坐姿 / 走路两帧（图集 entry = `<base>-<pose>`）。 */
export type CharacterPose = 'idle' | 'sit' | 'walk-1' | 'walk-2'

export interface PlannedCharacter {
  readonly occupant: StudioOccupant
  /** 本帧使用的姿态（决定图集 entry 与坐姿下移）。 */
  readonly pose: CharacterPose
  readonly dx: number
  readonly dy: number
  readonly alpha: number
  /** 水平镜像（行进方向/座位朝向）。 */
  readonly flip: boolean
  /** planFrame 内定的最终几何，调试叠层与渲染同源。 */
  readonly debug: PlannedCharacterDebug
}

/** L3 特效计划项：位置由帧表推导，alpha 随 done 淡出。 */
export interface PlannedEffect {
  readonly kind: 'sticker-mark' | 'sticker' | 'star' | 'bang' | 'bang-mark' | 'smoke'
  readonly x: number
  readonly y: number
  readonly alpha: number
}

export interface FramePlan {
  readonly characters: readonly PlannedCharacter[]
  readonly effects: readonly PlannedEffect[]
  /** 本帧各成员的 clip 起点 tick；执行器负责写回缓存。 */
  readonly tickStarts: Readonly<Record<string, number>>
}
