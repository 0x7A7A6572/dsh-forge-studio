import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentScopeContext } from '../src/agent/tool-gate.ts'
import type { DailyLogService } from '../src/service.ts'
import { DAILY_LOG_POINTER_TEXT, DAILY_LOG_REFERENCE_SECTION } from '../src/agent/reference.ts'
import { DAILY_LOG_TOOL_NAMES, installDailyLogTools } from '../src/agent/tools.ts'
import { TOOL_DISPATCHER } from '../src/agent/tool-dispatcher.ts'
import { createDailyLogGate } from '../src/index.ts'
import type { ToolGate } from '../src/agent/tool-gate.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
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

describe('全局注册面', () => {
  /**
   * 整个按需注入设计的命门：15 个工具必须【只】经 gate 按 agent 注入。
   * Task 2 那条「全局再注册一遍」的兼容行若被改回，gate 级用例（上面那条）仍会全绿 ——
   * 只有对全局 toolsCtx 的 register 调用集合做断言才能拦住它。
   */
  it('全局作用域只注册 1 个工具（daily_log 派发器）—— 15 个工具不得回到全局', () => {
    const registered: string[] = []
    let guards = 0
    let preExecuteHooks = 0
    const toolsCtx = {
      dailyLog: {},
      tools: {
        register: (def: ToolDefinition) => { registered.push(def.name); return () => {} },
        guard: () => { guards += 1; return () => {} },
      },
      on: (event: string) => { if (event === 'tools/pre-execute') preExecuteHooks += 1; return () => {} },
      get: () => undefined,
    } as unknown as Context

    installDailyLogTools(toolsCtx, {} as unknown as ToolGate)

    // 恰好一个：派发器（模型唯一的按需发现入口）。
    expect(registered).toEqual([TOOL_DISPATCHER])
    // 显式钉住「一个 daily_log_* 都不许出现在全局」，兼容行回归时这里必红。
    expect(registered.filter((name) => name.startsWith('daily_log_'))).toEqual([])
    // guard 与 pre-execute 钩子仍留在全局（这两条与工具的按需化无关，不该被顺手删掉）。
    expect(guards).toBe(1)
    expect(preExecuteHooks).toBe(1)
  })
})
