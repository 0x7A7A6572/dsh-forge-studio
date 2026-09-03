/**
 * 便签纸色板（Win11 便签同款六色）：卡片纸色 + 选中描边色。
 * 卡片是「便签纸」语义，固定 pastel 底 + 深色文字，不随宿主明暗主题变化
 * （类似宿主 --dsw-static-* 的刻意例外）；文字对比度在浅底上恒成立。
 */

import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '../../types.ts'
import type { NoteColor } from '../../types.ts'

export interface NoteColorMeta {
  readonly id: NoteColor
  /** 中文名（无障碍标签/色板 tooltip）。 */
  readonly label: string
  /** 卡片纸底色（浅 pastel）。 */
  readonly paper: string
  /** 选中描边/强调色（同色相深一档）。 */
  readonly ring: string
}

/** 六色表，顺序即色板展示顺序（默认黄在最前）。 */
export const NOTE_COLOR_PALETTE: readonly NoteColorMeta[] = [
  { id: 'yellow', label: '黄', paper: '#FFF1A6', ring: '#E3B341' },
  { id: 'blue', label: '蓝', paper: '#BBD8F7', ring: '#5A8FD6' },
  { id: 'green', label: '绿', paper: '#C3E6B0', ring: '#6DAE52' },
  { id: 'pink', label: '粉', paper: '#F9C6D6', ring: '#D9799A' },
  { id: 'purple', label: '紫', paper: '#D9C9F2', ring: '#9370C8' },
  { id: 'gray', label: '灰', paper: '#E2E2E2', ring: '#9A9A9A' },
]

const paletteById = new Map(NOTE_COLOR_PALETTE.map((c) => [c.id, c]))

/** 解析任意输入为色板元数据；未传/非法一律兜底默认色。 */
export function noteColorMeta(id?: NoteColor): NoteColorMeta {
  return (id !== undefined && paletteById.get(id)) || paletteById.get(DEFAULT_NOTE_COLOR)!
}

/** 便签纸上的固定深色文字（浅 pastel 底保证对比）。 */
export const NOTE_INK = '#2E2A22'
export const NOTE_INK_MUTED = 'rgba(46, 42, 34, 0.6)'
