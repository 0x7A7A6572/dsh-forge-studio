// 生成文件：scripts/build-pixel-atlas.mjs，勿手改。
export const ATLAS_SOURCE_SHA256 = '9460792d3e6281b5e46174465682900f25031685b8e948a8d6fdef10e0328d71'
export const ATLAS_SCRIPT_VERSION = '1.1.0'
export const ATLAS_PARAMS = { gap: 0, minArea: 15, maxWidth: 256 } as const
export const ATLAS_SHEETS = {
  env: { width: 81, height: 13 },
  chars: { width: 240, height: 53 },
  bg: { width: 256, height: 224 },
} as const

export interface AtlasMapEntry {
  id: string
  sheet: 'env' | 'chars'
  x: number
  y: number
  w: number
  h: number
  pivotX: number
  pivotY: number
}

export const ATLAS_ENTRIES: readonly AtlasMapEntry[] = [
  { id: 'char-1-idle', sheet: 'chars', x: 0, y: 0, w: 16, h: 24, pivotX: 8, pivotY: 24 },
  { id: 'char-1-sit', sheet: 'chars', x: 16, y: 0, w: 16, h: 24, pivotX: 8, pivotY: 24 },
  { id: 'char-1-walk-1', sheet: 'chars', x: 32, y: 0, w: 16, h: 25, pivotX: 8, pivotY: 25 },
  { id: 'char-1-walk-2', sheet: 'chars', x: 48, y: 0, w: 16, h: 25, pivotX: 8, pivotY: 25 },
  { id: 'char-2-idle', sheet: 'chars', x: 64, y: 0, w: 15, h: 23, pivotX: 7, pivotY: 23 },
  { id: 'char-2-sit', sheet: 'chars', x: 79, y: 0, w: 15, h: 24, pivotX: 7, pivotY: 24 },
  { id: 'char-2-walk-1', sheet: 'chars', x: 94, y: 0, w: 15, h: 25, pivotX: 7, pivotY: 25 },
  { id: 'char-2-walk-2', sheet: 'chars', x: 109, y: 0, w: 15, h: 25, pivotX: 7, pivotY: 25 },
  { id: 'char-3-idle', sheet: 'chars', x: 124, y: 0, w: 16, h: 25, pivotX: 8, pivotY: 25 },
  { id: 'char-3-sit', sheet: 'chars', x: 140, y: 0, w: 16, h: 25, pivotX: 8, pivotY: 25 },
  { id: 'char-3-walk-1', sheet: 'chars', x: 156, y: 0, w: 16, h: 27, pivotX: 8, pivotY: 27 },
  { id: 'char-3-walk-2', sheet: 'chars', x: 172, y: 0, w: 16, h: 27, pivotX: 8, pivotY: 27 },
  { id: 'char-4-idle', sheet: 'chars', x: 188, y: 0, w: 17, h: 23, pivotX: 8, pivotY: 23 },
  { id: 'char-4-sit', sheet: 'chars', x: 205, y: 0, w: 17, h: 25, pivotX: 8, pivotY: 25 },
  { id: 'char-4-walk-1', sheet: 'chars', x: 222, y: 0, w: 18, h: 26, pivotX: 9, pivotY: 26 },
  { id: 'char-4-walk-2', sheet: 'chars', x: 0, y: 27, w: 17, h: 26, pivotX: 8, pivotY: 26 },
  { id: 'cat-1', sheet: 'env', x: 0, y: 0, w: 16, h: 12, pivotX: 0, pivotY: 0 },
  { id: 'cat-2', sheet: 'env', x: 16, y: 0, w: 16, h: 13, pivotX: 0, pivotY: 0 },
  { id: 'corgi-1', sheet: 'env', x: 32, y: 0, w: 25, h: 10, pivotX: 0, pivotY: 0 },
  { id: 'corgi-2', sheet: 'env', x: 57, y: 0, w: 24, h: 11, pivotX: 0, pivotY: 0 },
]

export const BG_SHA256 = 'a9ea70826f5a6450213379cd02a8a0e3583cf8cb23a5a57fcc8c7687b4878a8c'
