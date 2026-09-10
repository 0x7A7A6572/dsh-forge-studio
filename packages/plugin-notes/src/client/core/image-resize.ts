/**
 * 图片拖拽缩放的纯计算：百分比宽度钳制与拖拽增量换算。
 * 无 React / 无 DOM，便于单测。
 */

/** 显示宽度百分比下限（过小会无法看清/难以再次命中手柄）。 */
export const IMAGE_WIDTH_MIN_PERCENT = 15
/** 显示宽度百分比上限（100% = 编辑器正文宽度）。 */
export const IMAGE_WIDTH_MAX_PERCENT = 100

/** 钳制显示宽度百分比到 [min, max]；非有限数回退到 min。 */
export function clampImageWidthPercent(
  value: number,
  min = IMAGE_WIDTH_MIN_PERCENT,
  max = IMAGE_WIDTH_MAX_PERCENT,
): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** 拖拽增量换算：起始百分比 + 像素位移 / 容器宽 * 100，取整并钳制。 */
export function nextImageWidthPercent(
  startPercent: number,
  deltaX: number,
  containerWidth: number,
): number {
  if (containerWidth <= 0) return clampImageWidthPercent(startPercent)
  const next = startPercent + (deltaX / containerWidth) * 100
  return Math.round(clampImageWidthPercent(next))
}
