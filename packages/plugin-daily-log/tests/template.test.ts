import { describe, expect, it } from 'vitest'
import { DATA_MARKER, DEFAULT_TEMPLATE_SKELETON, formatDateRange, joinTemplate, parseTemplate } from '../src/template.ts'

describe('parseTemplate', () => {
  it('有分隔线：其上指令段、其下骨架段', () => {
    const parts = parseTemplate('用简洁中文\n' + DATA_MARKER + '\n# 骨架')
    expect(parts.promptSection).toBe('用简洁中文')
    expect(parts.skeletonSection).toBe('# 骨架')
  })
  it('无分隔线：整份为骨架，指令段 null', () => {
    const parts = parseTemplate('  # 只有骨架  ')
    expect(parts.promptSection).toBeNull()
    expect(parts.skeletonSection).toBe('# 只有骨架')
  })
  it('只有分隔线无指令 → 指令段 null', () => {
    expect(parseTemplate(DATA_MARKER + '\n# s').promptSection).toBeNull()
  })
})

describe('joinTemplate', () => {
  it('空指令 → 纯骨架', () => {
    expect(joinTemplate(null, ' # s ')).toBe('# s')
  })
  it('指令 + 骨架 → 以分隔线拼接且可被 parse 还原', () => {
    const joined = joinTemplate('p', 's')
    expect(parseTemplate(joined)).toEqual({ promptSection: 'p', skeletonSection: 's' })
  })
})

describe('DEFAULT_TEMPLATE_SKELETON', () => {
  it('是五节业务骨架且不含 mustache', () => {
    expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 核心产出')
    expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 问题修复')
    expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 技术优化')
    expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 其他工作')
    expect(DEFAULT_TEMPLATE_SKELETON).toContain('## 下一步计划')
    expect(DEFAULT_TEMPLATE_SKELETON).not.toContain('{{')
    expect(parseTemplate(DEFAULT_TEMPLATE_SKELETON).promptSection).toBeNull()
  })
})

describe('formatDateRange', () => {
  it('无 until 只返回 since', () => {
    expect(formatDateRange({ since: '2026-06-30' })).toBe('2026-06-30')
  })
  it('有 until 用 ~ 连接', () => {
    expect(formatDateRange({ since: '2026-06-30', until: '2026-07-06' })).toBe('2026-06-30 ~ 2026-07-06')
  })
})
