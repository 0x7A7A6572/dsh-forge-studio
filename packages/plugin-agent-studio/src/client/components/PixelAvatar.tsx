/**
 * 像素头像（§6.5/卡 6）：从 chars 图集裁单角色 1:1 画进小 canvas（强调色变体），
 * 素材不可用回退自绘 fallback 精灵。缓存按 主题:entry:accent，CSS 负责放大。
 */
import { useEffect, useRef, useState } from 'react'
import charsPng from '../assets/pixel-office.chars.png'
import { decodeAtlasDataUrl, atlasSizeMatches, findAtlasEntry } from '../core/pixel/atlas.ts'
import { remapImageData } from '../core/pixel/lut.ts'
import { accentTargets } from '../core/pixel/painter-frame.ts'
import { avatarCacheKey, pickCharacter } from '../core/pixel/avatar-sprite.ts'
import { buildFallbackSprite, fallbackSpecFromSeed } from '../core/pixel/avatar-parts.ts'
import { resolveStagePalette, themeKeyOf } from '../core/pixel/stage-tokens.ts'
import type { DecodedAtlas } from '../core/pixel/atlas.ts'
import type { PixelSprite } from '../core/pixel/scene-types.ts'

const canvasCache = new Map<string, HTMLCanvasElement>()

let charsDecodedPromise: Promise<DecodedAtlas | null> | null = null

function charsDecoded(): Promise<DecodedAtlas | null> {
  charsDecodedPromise ??= decodeAtlasDataUrl(charsPng, 'chars').catch(() => null)
  return charsDecodedPromise
}

function spriteCanvas(sprite: PixelSprite, palette: ReturnType<typeof resolveStagePalette>): HTMLCanvasElement {
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
  return canvas
}

/** 解析 seed/覆盖项 → 单角色画布（变体缓存命中则同步返回）。 */
async function loadAvatarCanvas(
  seed: string,
  fallbackId: string,
  override?: { readonly entry: string; readonly accent: number },
): Promise<HTMLCanvasElement | null> {
  const picked =
    override !== undefined
      ? { entry: override.entry, accent: override.accent }
      : pickCharacter({ seed, fallback: fallbackId })
  const themeKey = themeKeyOf(document.body?.dataset.dsDarkTheme, matchMedia('(prefers-color-scheme: dark)').matches)
  const key = avatarCacheKey(themeKey, picked.entry, picked.accent)
  const hit = canvasCache.get(key)
  if (hit !== undefined) return hit
  const palette = resolveStagePalette()
  const decoded = await charsDecoded()
  const entry = findAtlasEntry(picked.entry)
  // 占位图（1×1）是合法 PNG 且 entry 命中，必须先判尺寸：不可用直接走 fallback。
  const usable = decoded !== null && atlasSizeMatches('chars', decoded.width, decoded.height)
  if (!usable || entry === undefined) {
    const spec = fallbackSpecFromSeed(seed, fallbackId)
    const canvas = spriteCanvas(buildFallbackSprite(spec.charIndex, spec.accent), palette)
    canvasCache.set(`placeholder:${key}`, canvas)
    return canvas
  }
  const canvas = document.createElement('canvas')
  canvas.width = entry.w
  canvas.height = entry.h
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  const region = new Uint8ClampedArray(entry.w * entry.h * 4)
  for (let dy = 0; dy < entry.h; dy++) {
    const src = ((entry.y + dy) * decoded.width + entry.x) * 4
    region.set(decoded.rgba.subarray(src, src + entry.w * 4), dy * entry.w * 4)
  }
  remapImageData(region, accentTargets(palette.lutTargets, picked.accent, palette))
  ctx.putImageData(new ImageData(region, entry.w, entry.h), 0, 0)
  canvasCache.set(key, canvas)
  return canvas
}

export interface PixelAvatarProps {
  /** profile.avatarSeed；'default'/空按 fallbackId（profile.id）生成。 */
  readonly seed: string
  readonly fallbackId: string
  /** 槽位边长（chip 选项 28 / 设置行 32），像素放大交给 CSS。 */
  readonly size: number
  /** 组合去重后的角色覆盖项（chip 列表用 assignCharacters 分配）；缺省按 seed 解析。 */
  readonly entry?: string
  readonly accent?: number
}

export function PixelAvatar({ seed, fallbackId, size, entry, accent }: PixelAvatarProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setFailed(false)
    loadAvatarCanvas(seed, fallbackId, entry !== undefined ? { entry, accent: accent ?? 0 } : undefined)
      .then((source) => {
        if (cancelled) return
        const canvas = canvasRef.current
        if (canvas === null) return
        const ctx = canvas.getContext('2d')
        if (ctx === null) return
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, size, size)
        if (source === null) {
          setFailed(true)
          return
        }
        ctx.drawImage(source, 0, 0, source.width, source.height, (size - source.width) / 2, (size - source.height) / 2, source.width, source.height)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [seed, fallbackId, size, entry, accent])

  // 素材完全不可用时的最后兜底：一枚 token 色圆点，保证不空白。
  if (failed) {
    return (
      <span
        style={{ width: size, height: size, borderRadius: size / 4, background: 'var(--dsw-alias-state-business-primary)' }}
        aria-hidden="true"
      />
    )
  }
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      aria-hidden="true"
    />
  )
}
