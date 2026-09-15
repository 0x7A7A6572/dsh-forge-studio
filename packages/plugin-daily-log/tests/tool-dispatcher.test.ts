import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createToolGate, type AgentScopeContext } from '../src/agent/tool-gate.ts'
import { createDailyLogDispatcher, TOOL_DISPATCHER } from '../src/agent/tool-dispatcher.ts'
import { DAILY_LOG_TOOL_NAMES } from '../src/agent/tools.ts'
import { DAILY_LOG_REFERENCE_TEXT } from '../src/agent/reference.ts'

function scopeWith() {
  const tools: string[] = []
  const scope = { tools: { register: (d: { name: string }) => { tools.push(d.name); return () => {} } } } as unknown as AgentScopeContext
  return { scope, tools }
}
const agentOf = (scope: AgentScopeContext) => ({ id: 's1', ctx: scope }) as unknown as Agent

describe('daily_log 派发器', () => {
  it('名字是裸名 daily_log，描述在预算内且提到触发场景', () => {
    const gate = createToolGate(() => () => {})
    const tool = createDailyLogDispatcher(gate)
    expect(tool.name).toBe(TOOL_DISPATCHER)
    expect(tool.description.length).toBeLessThanOrEqual(220)
    expect(tool.description.toLowerCase()).toContain('report')
  })

  it('调用后该 agent 拿到整组 15 个工具', async () => {
    const { scope, tools } = scopeWith()
    const gate = createToolGate((s) => {
      const out: Array<() => void> = []
      for (const name of DAILY_LOG_TOOL_NAMES) out.push(s.tools.register({ name } as never))
      return () => { for (const d of out) d() }
    })
    const tool = createDailyLogDispatcher(gate)
    const res = (await tool.execute({}, { agent: agentOf(scope) } as never)) as { enabled: boolean; tools: string[] }
    expect(res.enabled).toBe(true)
    expect(res.tools).toEqual([...DAILY_LOG_TOOL_NAMES])
    expect(tools).toEqual([...DAILY_LOG_TOOL_NAMES])
  })

  it('第二次调用报「已启用」且不重复注册', async () => {
    const { scope } = scopeWith()
    const gate = createToolGate((s) => { s.tools.register({ name: 'a' } as never); return () => {} })
    const tool = createDailyLogDispatcher(gate)
    const exec = { agent: agentOf(scope) } as never
    await tool.execute({}, exec)
    const res = (await tool.execute({}, exec)) as { enabled: boolean; message: string }
    expect(res.enabled).toBe(true)
    expect(res.message).toMatch(/already/i)
  })

  it('启用成功的结果里带完整引导文本 —— 模型不再依赖 prompt 段', async () => {
    const { scope } = scopeWith()
    const gate = createToolGate(() => () => {})
    const tool = createDailyLogDispatcher(gate)
    const result = (await tool.execute({}, { agent: agentOf(scope) } as never)) as { guidance?: string }
    expect(result.guidance).toBe(DAILY_LOG_REFERENCE_TEXT)
    expect(String(result.guidance)).toContain('data-driven')
    expect(String(result.guidance)).toContain('未经用户确认不得调用')

    // 模型真正读到的是 render 出来的文本，必须原样完整（不截断、不改写）。
    const blocks = tool.output.render({}, result as never)
    const rendered = blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
    expect(rendered).toContain(result.guidance)
  })

  it('拿不到 agent 时返回错误文本而不抛异常', async () => {
    const gate = createToolGate(() => () => {})
    const tool = createDailyLogDispatcher(gate)
    const res = (await tool.execute({}, {} as never)) as { enabled: boolean; message: string }
    expect(res.enabled).toBe(false)
    expect(res.message).toContain('/report')
  })
})
