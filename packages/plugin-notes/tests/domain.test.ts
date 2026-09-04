/**
 * 存储 schema 兼容性测试：旧记录（无 color 字段）打开不失败并回填默认色；
 * 合法 color 透传（含回归的紫色）；非法 color 被拒绝。这是 domain 打开不炸
 * 老数据的防线。
 */

import { describe, expect, it } from 'vitest'
import { noteRecordSchema } from '../src/domain.ts'
import type { NoteId } from '../src/types.ts'

const LEGACY = {
  id: 'legacy-1' as NoteId,
  title: '老便签',
  text: '旧数据没有 color 字段',
  pinned: false,
  createdAt: 1,
  updatedAt: 2,
}

describe('noteRecordSchema 兼容旧数据', () => {
  it('缺 color 的旧记录可解析并回填默认黄', () => {
    const parsed = noteRecordSchema.parse(LEGACY)
    expect(parsed.color).toBe('yellow')
  })

  it('缺 archived 的旧记录可解析并回填 false', () => {
    const parsed = noteRecordSchema.parse(LEGACY)
    expect(parsed.archived).toBe(false)
  })

  it('合法 color 原样透传', () => {
    const parsed = noteRecordSchema.parse({ ...LEGACY, color: 'pink' })
    expect(parsed.color).toBe('pink')
  })

  it('archived 原样透传', () => {
    const parsed = noteRecordSchema.parse({ ...LEGACY, archived: true })
    expect(parsed.archived).toBe(true)
  })

  it('非法 archived 类型被拒绝', () => {
    expect(() => noteRecordSchema.parse({ ...LEGACY, archived: 'yes' })).toThrow()
  })

  it('非法 color 值被拒绝', () => {
    expect(() => noteRecordSchema.parse({ ...LEGACY, color: 'neon' })).toThrow()
  })

  it('紫色回归为合法纸色，读取时原样透传', () => {
    const parsed = noteRecordSchema.parse({ ...LEGACY, color: 'purple' })
    expect(parsed.color).toBe('purple')
  })
})
