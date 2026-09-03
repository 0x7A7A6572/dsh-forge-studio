/**
 * 便签色板模块（note-colors.ts）契约测试：六色齐全、id 唯一、色值合法、
 * 默认黄兜底、任意 NoteColor 都能解析出元数据。
 */

import { describe, expect, it } from 'vitest'
import { NOTE_COLOR_PALETTE, noteColorMeta } from '../src/client/core/note-colors.ts'
import { NOTE_COLORS } from '../src/types.ts'
import type { NoteColor } from '../src/types.ts'

describe('NOTE_COLOR_PALETTE', () => {
  it('恰好覆盖六种颜色且 id 无重复', () => {
    const ids = NOTE_COLOR_PALETTE.map((c) => c.id)
    expect([...ids].sort()).toEqual([...NOTE_COLORS].sort())
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每种颜色都有可读 label 与合法色值', () => {
    for (const c of NOTE_COLOR_PALETTE) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.paper).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(c.ring).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

describe('noteColorMeta', () => {
  it('未传或传非法值时兜底默认色（黄）', () => {
    expect(noteColorMeta().id).toBe('yellow')
    expect(noteColorMeta('neon' as NoteColor).id).toBe('yellow')
  })

  it('六种颜色都能解析出对应元数据', () => {
    for (const id of NOTE_COLORS) {
      expect(noteColorMeta(id).id).toBe(id)
    }
  })
})
