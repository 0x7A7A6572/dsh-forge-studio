/**
 * 画布侧 token 取色（§2.3/§5.2）：canvas 不认 var()/color-mix()，
 * 先把 var(--x) 展开成具体值，再用 1×1 canvas fillRect + getImageData 探针取 RGB。
 * 每项解析失败的兜底由调用方给出（LUT 项用 Sweetie 源色，UI 用暗色实测值）。
 */
import { SWEETIE16_LUT, type Rgb } from './lut.ts'
import { FALLBACK_PALETTE } from './avatar-parts.ts'

/** token 读不到时的兜底色（暗色主题实测值，属允许的兜底常量）。 */
const FALLBACK_HEX = {
  base: '#151517',
  layer1: '#232324',
  layer2: '#2c2c2e',
  layer3: '#353638',
  dimmed: '#43454a',
  label: '#f9fafb',
  tertiary: '#adb2b8',
  business: '#7aaaff',
  businessDeep: '#34415b',
  success: '#22c55e',
  successSoft: '#4ed17e',
  warn: '#f59e0b',
  warnSoft: '#f7ad31',
  error: '#f25a5a',
  idle: '#545557',
} as const

export type FallbackKey = keyof typeof FALLBACK_HEX

export function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** 纯函数：把表达式里的 var(--x) 逐个替换为 resolve 提供的具体颜色。 */
export function expandVars(expr: string, resolve: (name: string) => string): string {
  return expr.replace(/var\((--[^)]*)\)/g, (_, name: string) => resolve(name.trim()))
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/**
 * 1×1 canvas fillRect + getImageData 探针：浏览器可能把 fillStyle 读回成
 * color(srgb …)/oklab(…) 字符串，直接读字符串不可靠，读像素才是唯一真相。
 * 表达式非法时 fillRect 不落色（alpha=0）→ 返回兜底。
 */
function probeColor(expr: string, fallback: Rgb): Rgb {
  if (typeof document === 'undefined') return fallback
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return fallback
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = expr
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    if (data[3] === 0) return fallback
    return [data[0], data[1], data[2]]
  } catch {
    return fallback
  }
}

/** var()+color-mix() 表达式 → RGB；var 展开失败回退 fallback 的 hex。 */
export function resolveRgbExpr(expr: string, fallback: Rgb): Rgb {
  const expanded = expandVars(expr, (name) => readToken(name, rgbToHex(fallback)))
  return probeColor(expanded, fallback)
}

/** var() 表达式 → 可直接赋 fillStyle 的具体颜色字符串。 */
export function resolveCssExpr(expr: string, fallback: Rgb): string {
  const rgb = resolveRgbExpr(expr, fallback)
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
}

/** 把具体颜色字符串解析成 RGB 三元组（#rgb/#rrggbb/rgb()/rgba()）。 */
export function parseRgb(color: string, fallback: Rgb): Rgb {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex !== null) {
    const body = hex[1]
    const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
  }
  const fn = color.match(/^rgba?\(([^)]+)\)$/i)
  if (fn !== null) {
    const parts = fn[1].split(/[,\s/]+/).filter((p) => p !== '').slice(0, 3)
    const nums = parts.map((p) => Number.parseFloat(p))
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) return [nums[0], nums[1], nums[2]]
  }
  return fallback
}

const tokenColor = (name: string, fallback: FallbackKey): string =>
  resolveCssExpr(`var(${name})`, hexToRgb(FALLBACK_HEX[fallback]))

/** 精灵层调色板：LUT 目标 RGB（atlas 重映射）+ UI 直绘色 + fallback 色表。 */
export interface StagePalette {
  readonly lutTargets: readonly Rgb[]
  readonly fallbackColors: Readonly<Record<number, string>>
  readonly ui: Readonly<Record<
    | 'wall' | 'floor' | 'floorLine' | 'partition' | 'partitionTop' | 'desk' | 'deskTop'
    | 'keyboard' | 'screenDark' | 'screenOn' | 'screenText' | 'snow' | 'check' | 'scan'
    | 'lampRunning' | 'lampIdle' | 'lampError' | 'lampDone'
    | 'sticker' | 'stickerMark' | 'star' | 'smoke' | 'bang' | 'monitorShell',
    string
  >>
  readonly accents: readonly string[]
}

const ACCENT_TOKENS = [
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-secondary',
  '--dsw-alias-label-tertiary',
] as const

/** 按当前主题解析整套绘制色；主题变化时整体重算一次。 */
export function resolveStagePalette(): StagePalette {
  const fallbackColors: Record<number, string> = {}
  for (const [index, expr] of Object.entries(FALLBACK_PALETTE)) {
    fallbackColors[Number(index)] = resolveCssExpr(expr, hexToRgb(FALLBACK_HEX.business))
  }
  return {
    // 兜底用各项自己的 Sweetie 源色：解析失败也只是不换色，不会全体变一个颜色。
    lutTargets: SWEETIE16_LUT.map((entry) => resolveRgbExpr(entry.token, entry.from)),
    fallbackColors,
    ui: {
      wall: tokenColor('--dsw-alias-bg-layer-1', 'layer1'),
      floor: tokenColor('--dsw-alias-bg-layer-2', 'layer2'),
      floorLine: tokenColor('--dsw-alias-label-dimmed', 'dimmed'),
      partition: tokenColor('--dsw-alias-bg-layer-3', 'layer3'),
      partitionTop: tokenColor('--dsw-alias-label-caption', 'tertiary'),
      desk: tokenColor('--dsw-alias-state-business-tertiary', 'businessDeep'),
      deskTop: tokenColor('--dsw-alias-label-caption', 'tertiary'),
      keyboard: tokenColor('--dsw-alias-label-tertiary', 'tertiary'),
      screenDark: tokenColor('--dsw-alias-bg-base', 'base'),
      screenOn: tokenColor('--dsw-alias-state-business-primary', 'business'),
      screenText: tokenColor('--dsw-alias-label-primary', 'label'),
      snow: tokenColor('--dsw-alias-label-primary', 'label'),
      check: tokenColor('--dsw-alias-state-success-primary', 'success'),
      scan: tokenColor('--dsw-alias-state-success-secondary', 'successSoft'),
      lampRunning: tokenColor('--dsw-alias-state-business-primary', 'business'),
      lampIdle: tokenColor('--dsw-alias-state-idle-primary', 'idle'),
      lampError: tokenColor('--dsw-alias-state-error-primary', 'error'),
      lampDone: tokenColor('--dsw-alias-state-success-primary', 'success'),
      sticker: tokenColor('--dsw-alias-state-success-secondary', 'successSoft'),
      stickerMark: tokenColor('--dsw-alias-label-primary', 'label'),
      star: tokenColor('--dsw-alias-state-warn-secondary', 'warnSoft'),
      smoke: tokenColor('--dsw-alias-label-dimmed', 'dimmed'),
      bang: tokenColor('--dsw-alias-state-error-primary', 'error'),
      monitorShell: tokenColor('--dsw-alias-bg-layer-3', 'layer3'),
    },
    accents: ACCENT_TOKENS.map((name) =>
      resolveCssExpr(`var(${name})`, hexToRgb(FALLBACK_HEX.business)),
    ),
  }
}

/** 主题缓存键：body 的暗色主题属性 + 系统深浅色偏好。 */
export function themeKeyOf(darkThemeAttr: string | undefined, prefersDark: boolean): string {
  return `${darkThemeAttr ?? ''}|${prefersDark ? 'dark' : 'light'}`
}
