import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { buildDailyLogTools, DAILY_LOG_TOOL_NAMES } from '../src/agent/tools.ts'
import type { DailyLogService } from '../src/service.ts'

describe('buildDailyLogTools', () => {
  it('产出 15 个定义，名字与 DAILY_LOG_TOOL_NAMES 一致', () => {
    const collected: ToolDefinition[] = []
    buildDailyLogTools({} as unknown as DailyLogService, (def) => { collected.push(def) })
    expect(collected).toHaveLength(15)
    expect(collected.map((d) => d.name)).toEqual([...DAILY_LOG_TOOL_NAMES])
  })

  it('全部以 daily_log_ 前缀命名', () => {
    expect(DAILY_LOG_TOOL_NAMES.every((n) => n.startsWith('daily_log_'))).toBe(true)
    expect(new Set(DAILY_LOG_TOOL_NAMES).size).toBe(15)
  })
})
