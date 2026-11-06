/**
 * L3 特效执行器（§5.4）：按帧计划画贴纸/星/感叹号/黑烟。
 * 每个计划项就是一次落笔；粒子预算在 plan 阶段裁剪。
 */
import type { PlannedEffect } from './painter-types.ts'
import type { AnyCtx } from './painter-types.ts'
import type { StagePalette } from './stage-tokens.ts'

function drawOne(ctx: AnyCtx, effect: PlannedEffect, palette: StagePalette): void {
  switch (effect.kind) {
    case 'sticker':
      ctx.fillStyle = palette.ui.sticker
      ctx.fillRect(effect.x, effect.y, 8, 6)
      return
    case 'sticker-mark':
      ctx.fillStyle = palette.ui.stickerMark
      ctx.fillRect(effect.x, effect.y, 2, 2)
      return
    case 'star':
      ctx.fillStyle = palette.ui.star
      ctx.fillRect(effect.x, effect.y, 1, 1)
      return
    case 'bang':
      ctx.fillStyle = palette.ui.bang
      ctx.fillRect(effect.x, effect.y, 3, 5)
      return
    case 'bang-mark':
      ctx.fillStyle = palette.ui.stickerMark
      ctx.fillRect(effect.x, effect.y, 1, 2)
      return
    case 'smoke':
      ctx.fillStyle = palette.ui.smoke
      ctx.fillRect(effect.x, effect.y, 2, 2)
      return
  }
}

/** 顺序执行特效计划；done 淡出的 alpha 已折进每个计划项。 */
export function drawPlannedEffects(
  ctx: AnyCtx,
  effects: readonly PlannedEffect[],
  palette: StagePalette,
): void {
  for (const effect of effects) {
    ctx.save()
    ctx.globalAlpha *= effect.alpha
    drawOne(ctx, effect, palette)
    ctx.restore()
  }
}
