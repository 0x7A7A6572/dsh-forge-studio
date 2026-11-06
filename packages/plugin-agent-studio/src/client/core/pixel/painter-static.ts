/**
 * 静态层绘制（§5.3 L0+L1）：bg 1:1 blit；bg 缺失时代码绘制占位背景
 * （纯色地板 + 8px 网格 + 墙线，§5.2 降级），不允许空白。
 */
import type { StudioScenePack } from './scene-types.ts'
import type { AnyCtx, StageAssets } from './painter-types.ts'
import type { StagePalette } from './stage-tokens.ts'

/** 代码占位背景：墙（上约 51%）+ 地板 + 8px 网格 + 墙线。 */
export function drawPlaceholderBackground(
  ctx: AnyCtx,
  scene: StudioScenePack,
  palette: StagePalette,
): void {
  const { width, height } = scene.canvas
  const wallY = Math.round(height * 0.51)
  ctx.fillStyle = palette.ui.lampIdle
  ctx.fillRect(0, 0, width, wallY)
  ctx.fillStyle = palette.ui.screenOn
  ctx.fillRect(0, wallY, width, height - wallY)
  ctx.globalAlpha = 0.25
  ctx.fillStyle = palette.ui.screenText
  for (let y = wallY; y < height; y += 8) ctx.fillRect(0, y, width, 1)
  for (let x = 0; x < width; x += 8) ctx.fillRect(x, wallY, 1, height - wallY)
  ctx.globalAlpha = 1
  ctx.fillStyle = palette.ui.screenDark
  ctx.fillRect(0, wallY - 1, width, 2)
}

/** L0+L1 合成：bg 已含全部家具/地板/墙，1:1 一次 blit；缺失时代码占位。 */
export function drawStaticLayer(
  ctx: AnyCtx,
  scene: StudioScenePack,
  assets: StageAssets,
  palette: StagePalette,
): void {
  const bitmap = assets.bg
  if (bitmap === undefined) {
    drawPlaceholderBackground(ctx, scene, palette)
    return
  }
  ctx.drawImage(bitmap.bitmap, 0, 0, scene.canvas.width, scene.canvas.height)
}
