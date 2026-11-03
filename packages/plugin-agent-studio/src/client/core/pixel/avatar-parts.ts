/**
 * 自绘 fallback 精灵部件（§6.6 第 5 条）：8px 网格小人 16×24 与 8×8 头像图标。
 * 索引调色板：1..11 固定部件，20+a = 强调色 a（0..5），30+c = 发色 c（0..4）。
 * 颜色由渲染层按 token 解析；本文件不含任何 hex。
 */
import { fnv1a32 } from './seed-hash.ts'
import type { PixelSprite } from './scene-types.ts'

export const FALLBACK_SPRITE_SIZE = { width: 16, height: 24 } as const
export const FALLBACK_ICON_SIZE = { width: 8, height: 8 } as const
export const ACCENT_INDEX_BASE = 20
export const HAIR_INDEX_BASE = 30

/** 固定部件索引：s 皮肤、e 眼、m 嘴、t 上衣、p 裤、b 鞋。 */
const CHAR_TO_INDEX: Record<string, number> = {
  s: 4,
  e: 6,
  m: 11,
  t: 7,
  p: 9,
  b: 10,
}

/** 基础模板 16×24：'.' = 透明；h/c 由发色与强调色变体替换。 */
const BASE_ROWS: readonly string[] = [
  '................',
  '.....cccccc.....',
  '....cccccccc....',
  '...cccccccccc...',
  '...cccchhhhcc...',
  '...hhssssssshh..',
  '...hsssssssssh..',
  '...ssssssssss...',
  '...sseesseess...',
  '...sseesseess...',
  '...ssssssssss...',
  '....ssmmmmss....',
  '....ssssssss....',
  '.....ssssss.....',
  '......ssss......',
  '....tttttttt....',
  '...tttttttttt...',
  '..tttttttttttt..',
  '..taattttttaat..',
  '..tttttttttttt..',
  '..tttttttttttt..',
  '...pppppppppp...',
  '...ppp....ppp...',
  '..bbbb....bbbb..',
]

/** 5 种发型：覆盖模板第 1..5 行（cc = 发色，h = 皮肤侧露）。 */
const HAIR_VARIANTS: readonly (readonly string[])[] = [
  [
    '.....cccccc.....',
    '....cccccccc....',
    '...cccccccccc...',
    '...cccccccccc...',
    '...cccchhhhcc...',
  ],
  [
    '....c.cc.cc.c...',
    '...cccccccccc...',
    '..cccccccccccc..',
    '...cccccccccc...',
    '...cccchhhhcc...',
  ],
  [
    '.....cccccc.....',
    '....cccccccc....',
    '...cccccccccc...',
    '..ccccchhhhccc..',
    '..cccchhhhhccc..',
  ],
  [
    '....cccccccc....',
    '....cccccccc....',
    '....cccccccc....',
    '....ccchhhhcc...',
    '....ccchhhhcc...',
  ],
  [
    '................',
    '.....cccccc.....',
    '....cccccccc....',
    '...cccccccccc...',
    '...ccccchhhh....',
  ],
]

/** 发型覆盖的行数；其余行沿用基础模板。 */
const HAIR_ROWS = HAIR_VARIANTS[0].length

function rowsFor(charIndex: number): readonly string[] {
  const hair = HAIR_VARIANTS[charIndex % HAIR_VARIANTS.length]
  return BASE_ROWS.map((row, i) => (i < HAIR_ROWS ? hair[i] : row))
}

function mapRow(row: string, charIndex: number, accent: number): Uint8Array {
  const out = new Uint8Array(row.length)
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '.') {
      out[i] = 0
    } else if (ch === 'c' || ch === 'h') {
      // c = 发色块；h 是发型镂空露出的皮肤。
      out[i] = ch === 'c' ? HAIR_INDEX_BASE + charIndex : CHAR_TO_INDEX.s
    } else if (ch === 'a') {
      out[i] = ACCENT_INDEX_BASE + accent
    } else {
      out[i] = CHAR_TO_INDEX[ch] ?? 0
    }
  }
  return out
}

/** 归一化 charIndex：负数或 ≥5 时取模，保证发色索引不越界。 */
function normalizeCharIndex(charIndex: number): number {
  return (((Math.trunc(charIndex) % 5) + 5) % 5)
}

/** 归一化 accent：负数或 ≥6 时取模，保证强调色索引 20..25 不越界。 */
function normalizeAccent(accent: number): number {
  return (((Math.trunc(accent) % 6) + 6) % 6)
}

/** 组装 16×24 fallback 小人；同 (charIndex, accent) 输出逐字节一致。 */
export function buildFallbackSprite(charIndex: number, accent: number): PixelSprite {
  const normalized = normalizeCharIndex(charIndex)
  const rows = rowsFor(normalized)
  const data = new Uint8Array(FALLBACK_SPRITE_SIZE.width * FALLBACK_SPRITE_SIZE.height)
  rows.forEach((row, y) => data.set(mapRow(row, normalized, normalizeAccent(accent)), y * FALLBACK_SPRITE_SIZE.width))
  return { width: FALLBACK_SPRITE_SIZE.width, height: FALLBACK_SPRITE_SIZE.height, data }
}

/** 组装 8×8 fallback 头像图标（图标位 28/32 用，放大交给 CSS pixelated）。 */
export function buildFallbackIcon(charIndex: number): PixelSprite {
  const hairIndex = HAIR_INDEX_BASE + normalizeCharIndex(charIndex)
  const rows = [
    [0, 0, hairIndex, hairIndex, hairIndex, hairIndex, 0, 0],
    [0, hairIndex, hairIndex, hairIndex, hairIndex, hairIndex, hairIndex, 0],
    [0, hairIndex, 4, 4, 4, 4, hairIndex, 0],
    [0, 4, 6, 6, 4, 6, 6, 0],
    [0, 4, 4, 4, 4, 4, 4, 0],
    [0, 0, 4, 4, 4, 4, 0, 0],
    [0, 0, 0, 4, 4, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ] as const
  const data = new Uint8Array(FALLBACK_ICON_SIZE.width * FALLBACK_ICON_SIZE.height)
  rows.forEach((row, y) => data.set(row, y * FALLBACK_ICON_SIZE.width))
  return { width: FALLBACK_ICON_SIZE.width, height: FALLBACK_ICON_SIZE.height, data }
}

/** seed 的确定性选型（fallback 用）：与 specFromSeed 同公式同 'default' 语义。 */
export function fallbackSpecFromSeed(seed: string, fallbackId: string): {
  charIndex: number
  accent: number
} {
  const effective = seed !== 'default' && seed.trim() !== '' ? seed : fallbackId
  const hash = fnv1a32(effective)
  return { charIndex: hash % 5, accent: (hash >>> 8) % 6 }
}

/**
 * fallback 索引 → CSS 颜色表达式（卡 3/6 渲染用；与 LUT 同为 token 引用，无 hex）。
 * key 只含模板实际用到的索引：4 皮肤、6 眼、7 衣、9 裤、10 鞋、11 嘴，
 * 20..25 = 强调色（§6.6 强调色池），30..34 = 发色（5 种区分色）；1..3/5/8 未用。
 */
export const FALLBACK_PALETTE: Readonly<Record<number, string>> = {
  4: 'var(--dsw-alias-state-warn-primary)', // 皮肤
  6: 'var(--dsw-alias-bg-base)', // 眼
  7: 'var(--dsw-alias-state-business-tertiary)', // 上衣
  9: 'var(--dsw-alias-bg-layer-3)', // 裤
  10: 'var(--dsw-alias-bg-base)', // 鞋
  11: 'var(--dsw-alias-state-error-primary)', // 嘴
  20: 'var(--dsw-alias-state-business-primary)',
  21: 'var(--dsw-alias-state-success-primary)',
  22: 'var(--dsw-alias-state-warn-primary)',
  23: 'var(--dsw-alias-state-error-primary)',
  24: 'var(--dsw-alias-state-success-secondary)',
  25: 'var(--dsw-alias-label-tertiary)',
  30: 'var(--dsw-alias-state-business-primary)',
  31: 'var(--dsw-alias-state-warn-secondary)',
  32: 'var(--dsw-alias-state-error-primary)',
  33: 'var(--dsw-alias-state-success-secondary)',
  34: 'var(--dsw-alias-label-tertiary)',
}
