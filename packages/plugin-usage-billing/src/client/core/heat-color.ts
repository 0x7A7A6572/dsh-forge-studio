/**
 * 热力图 5 档色阶：0 档 = 卡片底色，顶档 = 业务色，中间三档按 25/50/75% 混出来。
 * 与样式表里的 color-mix 阶梯同形，但 canvas 只认算好的具体颜色。
 */
import { FALLBACK_HEAT, readToken, resolveCssColor } from './chart-tokens.ts'
import type { HeatColors } from './heat-option.ts'

/** 解析成 [r,g,b]；解析不了返回 null（调用方退到兜底色阶）。 */
function toRgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex !== null) {
    const n = Number.parseInt(hex[1]!, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color)
  if (rgb !== null) {
    const parts = rgb[1]!.split(',').map((s) => Number.parseFloat(s.trim()))
    if (parts.length >= 3 && parts[0]! + parts[1]! + parts[2]! >= 0) {
      return [parts[0]!, parts[1]!, parts[2]!]
    }
  }
  return null
}

function mixColors(a: string, b: string, ratio: number): string {
  const ca = toRgb(a)
  const cb = toRgb(b)
  if (ca === null || cb === null) return ratio < 0.5 ? a : b
  const mix = (i: number): number => Math.round(ca[i]! + (cb[i]! - ca[i]!) * ratio)
  return 'rgb(' + mix(0) + ', ' + mix(1) + ', ' + mix(2) + ')'
}

/** 现读 token 的 5 档色阶（主题切换后由调用方重跑）。 */
export function heatColors(): HeatColors {
  const base = resolveCssColor(readToken('--dsw-alias-bg-layer-2', FALLBACK_HEAT[0]), FALLBACK_HEAT[0])
  const top = resolveCssColor(readToken('--dsw-alias-state-business-primary', FALLBACK_HEAT[4]), FALLBACK_HEAT[4])
  return [base, mixColors(base, top, 0.25), mixColors(base, top, 0.5), mixColors(base, top, 0.75), top]
}
