/**
 * atlas 运行时纯逻辑：data URL 解码、尺寸校验、LUT 重映射、位图缓存。
 * 只用浏览器 canvas API，不 import react；react 侧 hook 属卡 3。
 */
import { ATLAS_ENTRIES, ATLAS_SHEETS } from './atlas-map.generated.ts'
import { remapImageData, type Rgb } from './lut.ts'
import type { StudioAtlasEntry, StudioSheet } from './scene-types.ts'

export type { StudioSheet } from './scene-types.ts'

/** 解码后的单张图集：像素仍在 RGBA 数组里，可先重映射再转位图。 */
export interface DecodedAtlas {
  readonly sheet: StudioSheet
  readonly width: number
  readonly height: number
  readonly rgba: Uint8ClampedArray
}

/** 已重映射并转成可绘制位图的图集。 */
export interface AtlasBitmap {
  readonly sheet: StudioSheet
  readonly width: number
  readonly height: number
  readonly bitmap: ImageBitmap | HTMLCanvasElement
}

/** 占位图特征：1×1（ensure-pixel-assets.mjs 写入的兜底产物）。 */
export function isPlaceholderImage(width: number, height: number): boolean {
  return width === 1 && height === 1
}

/** 坐标表里登记的 sheet 尺寸。 */
export function sheetSize(sheet: StudioSheet): { readonly width: number; readonly height: number } {
  return ATLAS_SHEETS[sheet]
}

/** 实际解码尺寸与坐标表是否一致（占位图必然不一致）。 */
export function atlasSizeMatches(sheet: StudioSheet, width: number, height: number): boolean {
  const size = ATLAS_SHEETS[sheet]
  return width === size.width && height === size.height
}

/** bg + chars 都齐全且尺寸匹配才视为整体可用；bg/chars 各自可独立降级（hook 拆 flag）。 */
export function computeAtlasAvailable(sizes: readonly {
  sheet: StudioSheet
  width: number
  height: number
}[]): boolean {
  return (['bg', 'chars'] as const).every((sheet) => {
    const hit = sizes.find((s) => s.sheet === sheet)
    return hit !== undefined && atlasSizeMatches(sheet, hit.width, hit.height)
  })
}

/** 按语义 id 查图集条目。 */
export function findAtlasEntry(id: string): StudioAtlasEntry | undefined {
  return ATLAS_ENTRIES.find((e) => e.id === id)
}

async function decodeToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('atlas data URL decode failed'))
    image.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')
  ctx.drawImage(image, 0, 0)
  return canvas
}

/** 解码一张图集 data URL 并取出 RGBA 像素。 */
export async function decodeAtlasDataUrl(dataUrl: string, sheet: StudioSheet): Promise<DecodedAtlas> {
  const canvas = await decodeToCanvas(dataUrl)
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { sheet, width: canvas.width, height: canvas.height, rgba: imageData.data }
}

/** 原地按 16 项目标色重映射；目标色由 token 解析方（卡 3）算好传入。 */
export function remapDecodedAtlas(decoded: DecodedAtlas, targets: readonly Rgb[]): void {
  remapImageData(decoded.rgba, targets)
}

function rgbaToCanvas(rgba: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas
}

/** 把重映射后的像素转成 ImageBitmap（不可用时退回 canvas，可绘制性等价）。 */
export async function decodedToBitmap(decoded: DecodedAtlas): Promise<AtlasBitmap> {
  const canvas = rgbaToCanvas(decoded.rgba, decoded.width, decoded.height)
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(canvas)
      return { sheet: decoded.sheet, width: decoded.width, height: decoded.height, bitmap }
    } catch {
      // 某些环境禁用 createImageBitmap，canvas 本身也可直接 drawImage。
    }
  }
  return { sheet: decoded.sheet, width: decoded.width, height: decoded.height, bitmap: canvas }
}

export interface AtlasCache {
  /** 同一 themeKey 去重并发；loader 失败时移除缓存项，下次可重试。 */
  getOrLoad(themeKey: string, load: () => Promise<readonly AtlasBitmap[]>): Promise<readonly AtlasBitmap[]>
  /** 释放全部位图（ImageBitmap 调 close），并清空缓存。 */
  clear(): void
}

function closeBitmaps(bitmaps: readonly AtlasBitmap[]): void {
  for (const b of bitmaps) {
    const bitmap = b.bitmap as ImageBitmap
    if (typeof bitmap?.close === 'function') {
      try {
        bitmap.close()
      } catch {
        // 已关闭或实现不支持时忽略；canvas 落到这里没有 close 方法。
      }
    }
  }
}

/** 按主题键 memoize 图集位图；主题切换时 clear 后重算一次。 */
export function createAtlasCache(): AtlasCache {
  const store = new Map<string, Promise<readonly AtlasBitmap[]>>()
  let generation = 0
  return {
    getOrLoad(themeKey, load) {
      const cached = store.get(themeKey)
      if (cached !== undefined) return cached
      const gen = generation
      const created = load()
        .then((bitmaps) => {
          // 加载期间被 clear：位图直接释放，旧 awaiter 得到明确错误而非已关闭位图。
          if (gen !== generation) {
            closeBitmaps(bitmaps)
            throw new Error('atlas cache cleared during load')
          }
          return bitmaps
        })
        .catch((err) => {
          if (store.get(themeKey) === created) store.delete(themeKey)
          throw err
        })
      store.set(themeKey, created)
      return created
    },
    clear() {
      generation++
      store.clear()
    },
  }
}
