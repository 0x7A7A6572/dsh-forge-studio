import { describe, expect, it } from 'vitest'
import { DAILY_LOG_REFERENCE_TEXT } from '../src/agent/reference.ts'

describe('agent reference 三段提示', () => {
  it('含总则/收集/生成关键约束与工具名', () => {
    expect(DAILY_LOG_REFERENCE_TEXT).toContain('data-driven')
    expect(DAILY_LOG_REFERENCE_TEXT).toContain('daily_log_prepare_report')
    expect(DAILY_LOG_REFERENCE_TEXT).toContain('daily_log_save_report')
    expect(DAILY_LOG_REFERENCE_TEXT).toContain('未经用户确认')
  })
})
