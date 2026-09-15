import { describe, expect, it } from 'vitest'
import type { AgentScopeContext } from '../src/agent/tool-gate.ts'
import {
  DAILY_LOG_POINTER_SECTION,
  DAILY_LOG_POINTER_TEXT,
  DAILY_LOG_REFERENCE_SECTION,
  registerDailyLogGuidance,
} from '../src/agent/reference.ts'

describe('常驻短指针', () => {
  it('不引用任何具体 daily_log_ 工具名', () => {
    expect(DAILY_LOG_POINTER_TEXT.includes('daily_log_')).toBe(false)
  })
  it('体量在预算内（<= 450 字符）', () => {
    expect(DAILY_LOG_POINTER_TEXT.length).toBeLessThanOrEqual(450)
  })
  it('告诉模型怎么启用', () => {
    expect(DAILY_LOG_POINTER_TEXT).toContain('daily_log')
    expect(DAILY_LOG_POINTER_TEXT).toContain('/report')
  })
})

describe('registerDailyLogGuidance', () => {
  it('把详细段注册进给定 scope，name 沿用原名', () => {
    const sections: Array<{ name: string; order: number }> = []
    const scope = {
      tools: { register: () => () => {} },
      systemPrompt: { section: (s: { name: string; order: number }) => { sections.push(s); return () => {} } },
    } as unknown as AgentScopeContext
    registerDailyLogGuidance(scope)
    expect(sections).toHaveLength(1)
    expect(sections[0].name).toBe(DAILY_LOG_REFERENCE_SECTION)
    expect(sections[0].order).toBe(2950)
  })
  it('scope 没有 systemPrompt 时安静跳过', () => {
    const scope = { tools: { register: () => () => {} } } as unknown as AgentScopeContext
    expect(() => registerDailyLogGuidance(scope)).not.toThrow()
  })
})
