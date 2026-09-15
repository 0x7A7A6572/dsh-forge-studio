import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentScopeOf, createToolGate, type AgentScopeContext } from '../src/agent/tool-gate.ts'

function fakeScope() {
  const tools: string[] = []
  const sections: string[] = []
  const released: string[] = []
  const scope: AgentScopeContext = {
    tools: { register: (def) => { tools.push(def.name); return () => { released.push(def.name) } } },
    systemPrompt: { section: (s) => { sections.push(s.name); return () => { released.push(s.name) } } },
  }
  return { scope, tools, sections, released }
}
const fakeAgent = (scope: AgentScopeContext): Agent => ({ id: 's1', ctx: scope }) as unknown as Agent

describe('ToolGate', () => {
  it('enable 注册整组且幂等', () => {
    const { scope, tools, sections } = fakeScope()
    const gate = createToolGate((s) => {
      const out = [s.tools.register({ name: 'a' } as never)]
      out.push(s.systemPrompt!.section({ name: 'sec', order: 1, text: 'x' }))
      return () => { for (const d of out) d() }
    })
    const agent = fakeAgent(scope)
    expect(gate.enable(agent)).toBe(true)
    expect(gate.enable(agent)).toBe(false)
    expect(tools).toEqual(['a'])
    expect(sections).toEqual(['sec'])
  })

  it('按 agent 隔离', () => {
    const s1 = fakeScope(); const s2 = fakeScope()
    const gate = createToolGate((s) => { s.tools.register({ name: 'a' } as never); return () => {} })
    const agent = fakeAgent(s1.scope)          // 必须复用同一个对象：gate 用 WeakMap 按身份记
    gate.enable(agent)
    expect(s1.tools).toEqual(['a'])
    expect(s2.tools).toEqual([])
    expect(gate.isEnabled(agent)).toBe(true)
  })

  it('dispose 释放全部并关闭 gate', () => {
    const { scope, released } = fakeScope()
    const gate = createToolGate((s) => s.tools.register({ name: 'a' } as never))
    const agent = fakeAgent(scope)
    gate.enable(agent)
    gate.dispose()
    expect(released).toEqual(['a'])
    expect(gate.enable(agent)).toBe(false)
  })

  it('agent 没有 scope ctx 时抛错', () => {
    expect(() => agentScopeOf({ id: 'x' } as unknown as Agent)).toThrow(/agent scope context is unavailable/)
  })
})
