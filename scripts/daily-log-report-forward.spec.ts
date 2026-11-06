/**
 * /report 续接的门禁：forward 只能如实降级，不许把异常穿到指令 handler。
 *
 * 背景（实测故障）：forwarder 走属性读 ctx.agents，而插件根 inject 只声明了
 * storageDomain —— cordis 4 的 Context 是 Proxy，读未 inject 的服务属性直接抛
 * cannot get property "agents" without inject，且抛点在 forward 的 try 之外，
 * 用户敲 /report 带参数时拿到的是 gateway/internal。改走 ctx.get('agents')
 * （绕开 inject 校验的读取口，取不到返回 undefined）后，handler 侧还要兜住
 * forward 本身抛错的路径。
 */
import { describe, expect, it } from 'vitest'
import { createReportForwarder, handleReportCommand } from '../packages/plugin-daily-log/src/agent/command-report.ts'
import type { ToolGate } from '../packages/plugin-daily-log/src/agent/tool-gate.ts'

const AGENT_ID = 'agent-1'

function agent(): never {
  return { id: AGENT_ID } as never
}

function gate(): ToolGate {
  return { enable: () => true, isEnabled: () => true, dispose: () => {} } as ToolGate
}

function ctxWith(registry: unknown): never {
  return { get: (name: string) => (name === 'agents' ? registry : undefined) } as never
}

describe('createReportForwarder —— agents 未注入时的降级', () => {
  it('ctx.get(\'agents\') 返回 undefined：forward 返回 false，不抛错', () => {
    const forwarder = createReportForwarder(ctxWith(undefined))
    expect(() => forwarder.forward(agent(), '生成上周周报')).not.toThrow()
    expect(forwarder.forward(agent(), '生成上周周报')).toBe(false)
  })

  it('registry 里有该 agent 且 followup 正常：返回 true 并投递一条 user 消息', () => {
    const followupCalls: unknown[] = []
    const live = { followup: (message: unknown): void => { followupCalls.push(message) } }
    const forwarder = createReportForwarder(ctxWith({ get: (id: string) => (id === AGENT_ID ? live : undefined) }))
    expect(forwarder.forward(agent(), '生成上周周报')).toBe(true)
    expect(followupCalls).toHaveLength(1)
    expect(JSON.stringify(followupCalls[0])).toContain('生成上周周报')
  })

  it('followup 抛异常：forward 返回 false（driver 已收敛 / 已释放）', () => {
    const live = { followup: (): void => { throw new Error('driver closed') } }
    const forwarder = createReportForwarder(ctxWith({ get: (id: string) => (id === AGENT_ID ? live : undefined) }))
    expect(forwarder.forward(agent(), '生成上周周报')).toBe(false)
  })
})

describe('handleReportCommand —— forward 抛错时按「没续上」处理', () => {
  it('forwarder 抛异常：不穿到 handler，走「没能自动继续你的请求」文案', () => {
    const forwarder = {
      forward: (): boolean => { throw new Error('cannot get property "agents" without inject') },
    }
    const result = handleReportCommand(gate(), forwarder, { agent: agent(), rawInput: '生成上周周报' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('已启用工作报告能力')
    expect(result.text).toContain('没能自动继续你的请求')
  })

  it('forward 正常返回 false：文案一致（既有语义不变）', () => {
    const forwarder = { forward: (): boolean => false }
    const result = handleReportCommand(gate(), forwarder, { agent: agent(), rawInput: '生成上周周报' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('没能自动继续你的请求')
  })
})
