import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentScopeContext } from '../src/agent/tool-gate.ts'
import type { DailyLogService } from '../src/service.ts'
import { DAILY_LOG_POINTER_TEXT, DAILY_LOG_REFERENCE_SECTION } from '../src/agent/reference.ts'
import { DAILY_LOG_TOOL_NAMES } from '../src/agent/tools.ts'
import { createDailyLogGate } from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'

describe('默认态', () => {
  it('常驻指针不含任何 daily_log_ 工具名 —— 模型不会看到指向隐形工具的指令', () => {
    expect(DAILY_LOG_POINTER_TEXT.includes('daily_log_')).toBe(false)
  })
})

describe('createDailyLogGate', () => {
  it('一次 enable 同时注入 15 个工具与详细引导段；dispose 回收两者', () => {
    const names: string[] = []
    const sections: string[] = []
    const released: string[] = []
    const scope = {
      tools: {
        register: (def: { name: string }) => {
          names.push(def.name)
          return () => { released.push('tool:' + def.name) }
        },
      },
      systemPrompt: {
        section: (s: { name: string }) => {
          sections.push(s.name)
          return () => { released.push('section:' + s.name) }
        },
      },
    } as unknown as AgentScopeContext
    const ctx = { dailyLog: {} as DailyLogService } as unknown as Context
    const gate = createDailyLogGate(ctx)
    const agent = { id: 'a1', ctx: scope } as unknown as Agent

    expect(gate.isEnabled(agent)).toBe(false)
    expect(gate.enable(agent)).toBe(true)
    expect(names).toEqual([...DAILY_LOG_TOOL_NAMES])
    expect(sections).toEqual([DAILY_LOG_REFERENCE_SECTION])
    expect(gate.isEnabled(agent)).toBe(true)

    gate.dispose()
    expect(gate.isEnabled(agent)).toBe(false)
    expect(released).toHaveLength(16)
  })
})
