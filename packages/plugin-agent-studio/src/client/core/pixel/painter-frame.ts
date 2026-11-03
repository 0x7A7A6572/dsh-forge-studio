/**
 * 每帧绘制：静态 bg → 角色按脚底 z 序（姿态帧：静止/坐姿/走路1/走路2）→ 头顶特效。
 * 工作区完全静态（bg 烘焙，椅子常拉出）；坐下 = 人物换坐姿帧贴到椅面锚点，与建筑无关。
 * planFrame 是纯函数（node 可断言姿态与坐标），执行器只落笔。
 */
import { findAtlasEntry } from './atlas.ts'
import { remapImageData, type Rgb } from './lut.ts'
import { parseRgb } from './stage-tokens.ts'
import { clipFrameIndex } from './state-machine.ts'
import type {
  PixelSprite,
  StudioAnimationClip,
  StudioOccupant,
  StudioStageModel,
} from './scene-types.ts'
import {
  SIT_FRAME_DROP,
  SIT_FRAME_SHIFT_EAST,
  SIT_FRAME_SHIFT_WEST,
  seatSideOf,
} from './scene-office.ts'
import type { StagePalette } from './stage-tokens.ts'
import type {
  AnyCanvas,
  AnyCtx,
  FramePlan,
  PlannedCharacter,
  PlannedEffect,
  StageDrawOpts,
  CharacterPose,
} from './painter-types.ts'
import { drawPlannedEffects } from './painter-effects.ts'

/** 6 个强调色命中的 Sweetie 源色（衣服上的可替换色）。 */
const ACCENT_SOURCE_INDEXES = [7, 10, 14] as const
const PARTICLE_BUDGET = 24
const DONE_FADE_MS = 200
const HEAD_TOP_OFFSET = 28
/** 角色 sprite 素材的默认面朝方向（char-1..4 眼睛/面部均在左半边）。 */
const SPRITE_DEFAULT_FACING: 'left' | 'right' = 'left'
/** 走路循环帧切换间隔（tick）。 */
const WALK_FRAME_TICKS = 4

/** 取当前帧号；reduced-motion 下循环停 f0、一次性跳末帧。 */
export function stageFrameIndex(
  clip: StudioAnimationClip,
  elapsedTicks: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return clip.loop ? 0 : clip.frameCount - 1
  return clipFrameIndex(clip, elapsedTicks)
}

/** 纯函数：把强调色写进目标表的 Sweetie 衣色位（自检与变体画布共用）。 */
export function accentTargets(base: readonly Rgb[], accent: number, palette: StagePalette): Rgb[] {
  const color = parseRgb(palette.accents[accent % palette.accents.length], [255, 255, 255])
  return base.map((rgb, i) => (ACCENT_SOURCE_INDEXES.includes(i as never) ? color : rgb))
}

function charVariantCanvas(
  decoded: NonNullable<StageDrawOpts['assets']['charsDecoded']>,
  entryId: string,
  palette: StagePalette,
  cache: Map<string, AnyCanvas>,
  themeKey: string,
): AnyCanvas | undefined {
  const entry = findAtlasEntry(entryId)
  if (entry === undefined) return undefined
  const key = `${themeKey}:${entryId}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const canvas = document.createElement('canvas')
  canvas.width = entry.w
  canvas.height = entry.h
  const ctx = canvas.getContext('2d')
  if (ctx === null) return undefined
  const region = new Uint8ClampedArray(entry.w * entry.h * 4)
  for (let dy = 0; dy < entry.h; dy++) {
    const src = ((entry.y + dy) * decoded.width + entry.x) * 4
    region.set(decoded.rgba.subarray(src, src + entry.w * 4), dy * entry.w * 4)
  }
  // 舞台角色按素材原色渲染：强调色变体只用于 PixelAvatar 小头像——
  // 强调色会替换眼镜高光/领带/裤色等 Sweetie 位（ACCENT_SOURCE_INDEXES），
  // 放大到舞台尺寸看起来像花屏（人物局部变蓝）。
  remapImageData(region, palette.lutTargets)
  ctx.putImageData(new ImageData(region, entry.w, entry.h), 0, 0)
  cache.set(key, canvas)
  return canvas
}

function fallbackCanvas(
  sprite: PixelSprite,
  palette: StagePalette,
  cache: Map<string, AnyCanvas>,
  themeKey: string,
): AnyCanvas {
  const key = `${themeKey}:${sprite.width}x${sprite.height}:${[...sprite.data].join(',')}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const canvas = document.createElement('canvas')
  canvas.width = sprite.width
  canvas.height = sprite.height
  const ctx = canvas.getContext('2d')
  if (ctx !== null) {
    for (let i = 0; i < sprite.data.length; i++) {
      const color = palette.fallbackColors[sprite.data[i]]
      if (color === undefined) continue
      ctx.fillStyle = color
      ctx.fillRect(i % sprite.width, Math.floor(i / sprite.width), 1, 1)
    }
  }
  cache.set(key, canvas)
  return canvas
}

/** done 成员在到期前 200ms 线性淡出（opacity 由渲染层实现，不入 clips）。 */
function doneAlpha(model: StudioStageModel, memberId: string, now: number): number {
  const doneUntil = model.memo.doneUntil?.[memberId]
  if (doneUntil === undefined) return 1
  return Math.max(0, Math.min(1, (doneUntil - now) / DONE_FADE_MS))
}

function occupantPivot(occupant: StudioOccupant, pose: CharacterPose): { x: number; y: number } {
  const entry = findAtlasEntry(`${occupant.character.entry}-${pose}`) ??
    findAtlasEntry(occupant.character.entry)
  return { x: entry?.pivotX ?? 8, y: entry?.pivotY ?? 24 }
}

function seatPointOf(occupant: StudioOccupant): { x: number; y: number } {
  // 座位点 = 槽位锚点按 seat 平移（溢出成员坐在沙发多个座位上）。
  return {
    x: occupant.slot.anchor.x + occupant.seat * occupant.slot.anchorStep,
    y: occupant.slot.anchor.y,
  }
}

const EFFECT_WEIGHT: Record<PlannedEffect['kind'], number> = {
  sticker: 3,
  'sticker-mark': 0,
  star: 1,
  bang: 3,
  'bang-mark': 0,
  smoke: 1,
}

/** 帧表 effects → 计划项：贴纸/星/爆炸/烟挂在头顶，预算内整组裁掉。 */
function planEffectsFor(
  effects: PlannedEffect[],
  kind: string,
  anchor: { x: number; y: number },
  frameIndex: number,
  frameOffset: { x: number; y: number },
  alpha: number,
  budget: { left: number; groups: number },
): void {
  const headTop = anchor.y - HEAD_TOP_OFFSET
  if (budget.groups >= 3) return
  if (kind === 'sticker') {
    const y = headTop + frameOffset.y
    budget.left -= EFFECT_WEIGHT.sticker
    budget.groups += 1
    effects.push({ kind: 'sticker', x: anchor.x - 4, y, alpha })
    effects.push({ kind: 'sticker-mark', x: anchor.x - 2, y: y + 2, alpha })
    effects.push({ kind: 'sticker-mark', x: anchor.x + 1, y: y + 3, alpha })
  } else if (kind === 'star') {
    const rise = Math.min(3, Math.max(0, frameIndex - 3))
    budget.left -= 4
    budget.groups += 1
    for (let i = 0; i < 4; i++) {
      effects.push({
        kind: 'star',
        x: anchor.x - 5 + i * 3,
        y: headTop - 3 - rise - (i % 2) + frameOffset.y,
        alpha,
      })
    }
  } else if (kind === 'bang') {
    budget.left -= EFFECT_WEIGHT.bang
    budget.groups += 1
    effects.push({ kind: 'bang', x: anchor.x - 1, y: headTop - 2, alpha: 1 })
    effects.push({ kind: 'bang-mark', x: anchor.x, y: headTop - 1, alpha: 1 })
  } else if (kind === 'smoke') {
    const drift = Math.min(2, Math.max(0, frameIndex - 1))
    budget.left -= 2
    budget.groups += 1
    effects.push({ kind: 'smoke', x: anchor.x - 6 + drift, y: headTop + 8 - drift, alpha: 1 })
    effects.push({ kind: 'smoke', x: anchor.x + 8 - drift, y: headTop + 6 - drift, alpha: 1 })
  }
}

/** 座位朝向：坐姿帧原生朝东——西椅（尾数 1）不镜像，东椅（尾数 2）镜像朝西；lead 扶手椅朝东不镜像。 */
function seatedFlip(occupant: StudioOccupant): boolean {
  if (occupant.slot.role === 'lead') return false
  return seatSideOf(occupant.slot) === 'east'
}

/**
 * 帧计划：每个成员一个姿态帧（坐下=坐姿帧贴椅面锚点，行走=走路1/2 交替，
 * 其余=静止帧），按脚底 z 序；lead/溢出同规则。工作区静态，无任何工位区域。
 */
export function planFrame(
  model: StudioStageModel,
  tick: number,
  now: number,
  palette: StagePalette,
  reducedMotion: boolean,
  tickStart: ReadonlyMap<string, number>,
): FramePlan {
  const characters: PlannedCharacter[] = []
  const effects: PlannedEffect[] = []
  const starts = new Map(tickStart)
  const budget = { left: PARTICLE_BUDGET, groups: 0 }
  const overflowCapacity = model.overflowMembers[0]?.slot.capacity ?? 0
  const drawList = [
    ...model.occupants,
    ...model.overflowMembers.slice(0, overflowCapacity),
    ...model.roamers,
  ]

  for (const occupant of drawList) {
    const clip = model.scene.clips[occupant.visual]
    let start = starts.get(occupant.memberId)
    if (
      start === undefined ||
      model.memo.previousVisuals?.[occupant.memberId] !== occupant.visual
    ) {
      start = tick
      starts.set(occupant.memberId, start)
    }
    const frameIndex = stageFrameIndex(clip, tick - start, reducedMotion)
    const frame = clip.frames[frameIndex]
    const alpha = occupant.visual === 'done' ? doneAlpha(model, occupant.memberId, now) : 1
    const seat = seatPointOf(occupant)
    const atSeat = Math.abs(occupant.foot.x - seat.x) < 0.5 && Math.abs(occupant.foot.y - seat.y) < 0.5
    let pose: CharacterPose
    let flip = false
    const footX = occupant.foot.x
    const footY = occupant.foot.y
    if (!atSeat) {
      // 行走/游走中：朝向按行进方向；走路帧 1/2 交替（帧内自带步伐弹跳）。
      pose = Math.floor(tick / WALK_FRAME_TICKS) % 2 === 0 ? 'walk-1' : 'walk-2'
      const moveDx = occupant.moveDx ?? 0
      if (moveDx > 0) flip = SPRITE_DEFAULT_FACING !== 'right'
      else if (moveDx < 0) flip = SPRITE_DEFAULT_FACING !== 'left'
    } else if (occupant.visual !== 'idle') {
      // 坐下：坐姿帧贴椅面锚点，朝向按座位在块内的东西侧。
      pose = 'sit'
      flip = seatedFlip(occupant)
    } else {
      pose = 'idle'
      flip = seatedFlip(occupant)
    }
    const pivot = occupantPivot(occupant, pose)
    // done 的帧位移语义属于贴纸/星星，本体不动。
    const bodyOffset = occupant.visual === 'done' ? { x: 0, y: 0 } : frame.offset
    // 坐姿水平微调：共享工位两侧人物贴准椅子（西椅右移 5px，东椅左移 10px；lead/溢出不调）。
    const sitShift =
      pose === 'sit' && occupant.slot.id.startsWith('seat-')
        ? seatSideOf(occupant.slot) === 'west'
          ? SIT_FRAME_SHIFT_WEST
          : SIT_FRAME_SHIFT_EAST
        : 0
    characters.push({
      occupant,
      pose,
      dx: footX - pivot.x + bodyOffset.x + sitShift,
      dy: footY - pivot.y + bodyOffset.y + (pose === 'sit' ? SIT_FRAME_DROP : 0),
      alpha,
      flip,
      debug: {
        frameIndex,
        atSeat,
        sitting: pose === 'sit',
        facing: flip ? 'right' : 'left',
        flip,
        sitShift,
        footX,
        footY,
      },
    })
    for (const kind of frame.effects) {
      planEffectsFor(effects, kind, occupant.foot, frameIndex, frame.offset, alpha, budget)
    }
  }
  return { characters, effects, tickStarts: Object.fromEntries(starts) }
}

function drawCharacter(
  ctx: AnyCtx,
  occupant: StudioOccupant,
  pose: CharacterPose,
  dx: number,
  dy: number,
  flip: boolean,
  opts: StageDrawOpts,
): void {
  const decoded = opts.assets.charsDecoded
  if (decoded !== undefined) {
    const entryId = `${occupant.character.entry}-${pose}`
    const canvas = charVariantCanvas(
      decoded,
      findAtlasEntry(entryId) !== undefined ? entryId : occupant.character.entry,
      opts.palette,
      opts.caches.variant,
      opts.themeKey,
    )
    if (canvas !== undefined) {
      const usedId = findAtlasEntry(entryId) !== undefined ? entryId : occupant.character.entry
      const entry = findAtlasEntry(usedId)
      const w = entry?.w ?? 16
      const h = entry?.h ?? 24
      if (flip) {
        // 水平镜像：原点平到精灵右缘再镜像，源整幅 1:1 画回 [dx, dx+w]。
        ctx.save()
        ctx.translate(dx + w, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(canvas, 0, 0, w, h, 0, dy, w, h)
        ctx.restore()
        return
      }
      ctx.drawImage(canvas, dx, dy)
      return
    }
  }
  if (occupant.character.fallback !== undefined) {
    const canvas = fallbackCanvas(
      occupant.character.fallback,
      opts.palette,
      opts.caches.fallback,
      opts.themeKey,
    )
    const fw = occupant.character.fallback.width
    const fh = occupant.character.fallback.height
    if (flip) {
      ctx.save()
      ctx.translate(dx + fw, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(canvas, 0, 0, fw, fh, 0, dy, fw, fh)
      ctx.restore()
      return
    }
    ctx.drawImage(canvas, dx, dy)
  }
}

/** 执行帧计划：clear → bg（静态层）→ 角色按 z 序 → 头顶特效。 */
export function drawStageFrame(
  ctx: AnyCtx,
  model: StudioStageModel,
  opts: StageDrawOpts,
): FramePlan {
  const { width, height } = model.scene.canvas
  ctx.clearRect(0, 0, width, height)
  const staticLayer = opts.caches.staticLayer
  if (staticLayer !== undefined) ctx.drawImage(staticLayer, 0, 0, width, height)
  const plan = planFrame(
    model,
    opts.tick,
    opts.now,
    opts.palette,
    opts.reducedMotion,
    opts.caches.tickStart,
  )
  // plan 不改入参；新起点由执行器写回缓存供下一帧续播。
  for (const [memberId, start] of Object.entries(plan.tickStarts)) {
    opts.caches.tickStart.set(memberId, start)
  }
  const items = [...plan.characters].sort((a, b) => a.occupant.foot.y - b.occupant.foot.y)
  for (const character of items) {
    ctx.save()
    ctx.globalAlpha = character.alpha
    drawCharacter(ctx, character.occupant, character.pose, character.dx, character.dy, character.flip, opts)
    ctx.restore()
  }
  drawPlannedEffects(ctx, plan.effects, opts.palette)
  return plan
}
