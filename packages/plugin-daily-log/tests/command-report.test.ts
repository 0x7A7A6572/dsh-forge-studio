/**
 * /report 斜杠指令：纯 handler（依赖注入）+ 注册/注销与开关联动。
 * 不启真宿主 —— cordis Context / commands 服务 / settings 都用最小假件。
 */

import { describe, expect, it } from 'vitest'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { createToolGate, type AgentScopeContext } from '../src/agent/tool-gate.ts'
import { DAILY_LOG_TOOL_NAMES } from '../src/agent/tools.ts'
import { DAILY_LOG_REFERENCE_TEXT } from '../src/agent/reference.ts'
import {
  COMMAND_REPORT,
  createReportForwarder,
  handleReportCommand,
  installReportCommand,
  type ReportForwarder,
} from '../src/agent/command-report.ts'
import {
  DAILY_LOG_CONFIG_BASE,
  createDailyLogSettingsAccess,
  type DailyLogConfig,
} from '../src/settings.ts'

/** agent scope 假件：记录注册与释放的工具名。 */
function fakeScope() {
  const registered: string[] = []
  const released: string[] = []
  const scope: AgentScopeContext = {
    tools: {
      register: (definition) => {
        registered.push(definition.name)
        return () => { released.push(definition.name) }
      },
    },
  }
  return { scope, registered, released }
}

const fakeAgent = (scope: AgentScopeContext): Agent => ({ id: 's1', ctx: scope }) as unknown as Agent

/** 注册整组 15 个工具的 gate。 */
function toolkitGate(): ReturnType<typeof createToolGate> {
  return createToolGate((scope) => {
    const disposers = DAILY_LOG_TOOL_NAMES.map((name) => scope.tools.register({ name } as never))
    return () => { for (const dispose of disposers) dispose() }
  })
}

/** 记录续接调用的假 forwarder。 */
function recordingForwarder(accepted: boolean) {
  const forwarded: string[] = []
  const forwarder: ReportForwarder = {
    forward: (_agent, text) => { forwarded.push(text); return accepted },
  }
  return { forwarder, forwarded }
}

describe('handleReportCommand（纯 handler）', () => {
  it('先启用整组工具，再把用户请求续给模型', () => {
    const { scope, registered } = fakeScope()
    const agent = fakeAgent(scope)
    const gate = toolkitGate()
    const { forwarder, forwarded } = recordingForwarder(true)

    const result = handleReportCommand(gate, forwarder, { agent, rawInput: '  生成上周周报  ' })

    expect(result.kind).toBe('success')
    expect(registered).toEqual([...DAILY_LOG_TOOL_NAMES])
    expect(gate.isEnabled(agent)).toBe(true)
    // 去首尾空白后原样续接；其后紧跟详细引导段（引导必须随对话到达模型）
    expect(forwarded).toEqual([`生成上周周报\n\n${DAILY_LOG_REFERENCE_TEXT}`])
    expect(result.text).toContain('正在按你的要求生成')
  })

  it('续接消息带上引导文本 —— 指令路径不经过派发器也能拿到引导', () => {
    const { scope } = fakeScope()
    const gate = toolkitGate()
    const { forwarder, forwarded } = recordingForwarder(true)

    handleReportCommand(gate, forwarder, { agent: fakeAgent(scope), rawInput: '生成上周周报' })

    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]!).toContain('data-driven')
    expect(forwarded[0]!.indexOf('生成上周周报')).toBeLessThan(forwarded[0]!.indexOf('data-driven'))
    expect(forwarded[0]!).toContain(DAILY_LOG_REFERENCE_TEXT)   // 全文，不截断、不改写
  })

  it('没有 rawInput 时只启用、不续接，并回报可用工具数', () => {
    const { scope } = fakeScope()
    const gate = toolkitGate()
    const { forwarder, forwarded } = recordingForwarder(true)

    const result = handleReportCommand(gate, forwarder, { agent: fakeAgent(scope), rawInput: '   ' })

    expect(result.kind).toBe('success')
    expect(forwarded).toEqual([])
    expect(result.text).toContain('15')
    expect(result.text).toContain('把需求告诉我')
  })

  it('重复触发报告已处于启用状态，且不再重复注册', () => {
    const { scope, registered } = fakeScope()
    const agent = fakeAgent(scope)
    const gate = toolkitGate()
    const { forwarder } = recordingForwarder(true)
    const first = handleReportCommand(gate, forwarder, { agent, rawInput: '生成周报' })
    const second = handleReportCommand(gate, forwarder, { agent, rawInput: '' })

    expect(first.text).not.toContain('已处于启用状态')
    expect(second.text).toContain('已处于启用状态')
    expect(registered).toEqual([...DAILY_LOG_TOOL_NAMES])   // 只注册一次
  })

  it('续接失败时给出区别明显、不谎称成功续接的文案', () => {
    const { scope } = fakeScope()
    const agent = fakeAgent(scope)
    const gate = toolkitGate()
    const { forwarder } = recordingForwarder(false)

    const failed = handleReportCommand(gate, forwarder, { agent, rawInput: '生成周报' })
    const ok = handleReportCommand(gate, recordingForwarder(true).forwarder, { agent, rawInput: '生成周报' })

    expect(failed.kind).toBe('success')            // 启用本身成功
    expect(failed.text).toContain('请把需求再说一次')
    expect(failed.text).not.toBe(ok.text)
    expect(gate.isEnabled(agent)).toBe(true)       // 续接失败不影响启用
  })

  it('启用失败返回 kind error，且不会继续续接', () => {
    const gate = toolkitGate()
    const { forwarder, forwarded } = recordingForwarder(true)

    const result = handleReportCommand(gate, forwarder, {
      agent: { id: 'x' } as unknown as Agent,   // 没有 scope ctx → enable 抛错
      rawInput: '生成周报',
    })

    expect(result.kind).toBe('error')
    expect(result.text).toContain('启用工作报告能力失败')
    expect(forwarded).toEqual([])
  })
})

describe('createReportForwarder', () => {
  it('运行时 agent 可寻址时续出一条 user 消息', () => {
    const seen: unknown[] = []
    const live = {
      id: 's1',
      followup: (message: unknown) => { seen.push(message) },
    } as unknown as Agent
    const ctx = { agents: { get: (id: string) => (id === 's1' ? live : undefined) } } as unknown as Context

    expect(createReportForwarder(ctx).forward(live, '生成上周周报')).toBe(true)
    expect(seen).toHaveLength(1)
    const message = seen[0] as {
      id: string
      role: string
      content: Array<{ type: string; text: string }>
      source: { kind: string }
    }
    expect(message.role).toBe('user')
    expect(message.content).toEqual([{ type: 'text', text: '生成上周周报' }])
    expect(message.source).toEqual({ kind: 'user' })
    expect(typeof message.id).toBe('string')
    expect(message.id.length).toBeGreaterThan(0)
    expect(Object.isFrozen(message)).toBe(true)          // 与 createUserMessage 一样交付不可变消息
    expect(Object.isFrozen(message.content)).toBe(true)
  })

  it('agent 不在注册表里时返回 false', () => {
    const ctx = { agents: { get: () => undefined } } as unknown as Context
    const agent = { id: 'gone' } as unknown as Agent

    expect(createReportForwarder(ctx).forward(agent, '生成周报')).toBe(false)
  })

  it('followup 抛错时返回 false 而不是把异常抛给指令层', () => {
    const live = {
      id: 's1',
      followup: () => { throw new Error('driver gone') },
    } as unknown as Agent
    const ctx = { agents: { get: () => live } } as unknown as Context

    expect(createReportForwarder(ctx).forward(live, '生成周报')).toBe(false)
  })
})

/** 最小假宿主：inject/effect/agents/commands + 可热切换的 settings。 */
function fakeHost(options: { enable?: boolean } = {}) {
  let current: DailyLogConfig = {
    ...DAILY_LOG_CONFIG_BASE,
    enableReportCommand: options.enable ?? true,
  }
  let push: ((next: DailyLogConfig) => void) | undefined
  const settings = createDailyLogSettingsAccess()
  settings.bind({ get: () => current, watch: (callback) => { push = callback; return () => { push = undefined } } })

  const definitions: CommandDefinition[] = []
  const unregistered: string[] = []
  const effects: Array<() => void> = []
  const commandCtx = {
    commands: {
      register: (definition: CommandDefinition): (() => void) => {
        definitions.push(definition)
        return () => { unregistered.push(definition.name) }
      },
    },
  }
  const ctx = {
    agents: { get: () => undefined },
    inject: (_deps: readonly string[], callback: (scoped: unknown) => void): (() => void) => {
      callback(commandCtx)
      return () => {}
    },
    effect: (callback: () => (() => void) | void): void => {
      const dispose = callback()
      if (typeof dispose === 'function') effects.push(dispose)
    },
  } as unknown as Context

  return {
    ctx, settings, definitions, unregistered,
    setEnabled(value: boolean) {
      current = { ...current, enableReportCommand: value }
      push?.(current)
    },
    teardown() { for (const dispose of effects) dispose() },
  }
}

describe('installReportCommand', () => {
  it('开关为 true 时注册指令，且只注册一次', () => {
    const host = fakeHost({ enable: true })
    installReportCommand(host.ctx, toolkitGate(), host.settings)

    expect(host.definitions).toHaveLength(1)
    const definition = host.definitions[0]!
    expect(definition.name).toBe(COMMAND_REPORT)
    expect(definition.name).toBe('report')                 // 宿主语法：^[a-z][a-z0-9_-]*$
    expect(definition.description).toMatch(/[\u4e00-\u9fa5]/)   // 给人看的描述是中文
    expect(definition.input?.hint).toBeTruthy()
    expect(typeof definition.handler).toBe('function')
  })

  it('开关为 false 时不注册', () => {
    const host = fakeHost({ enable: false })
    installReportCommand(host.ctx, toolkitGate(), host.settings)

    expect(host.definitions).toEqual([])
  })

  it('开关注销热切换：true → false 注销，false → true 再注册', () => {
    const host = fakeHost({ enable: true })
    installReportCommand(host.ctx, toolkitGate(), host.settings)
    expect(host.definitions).toHaveLength(1)

    host.setEnabled(false)
    expect(host.unregistered).toEqual([COMMAND_REPORT])

    host.setEnabled(true)
    expect(host.definitions).toHaveLength(2)
    expect(host.definitions[1]!.name).toBe(COMMAND_REPORT)
  })

  it('从 false 起订阅，翻到 true 时注册', () => {
    const host = fakeHost({ enable: false })
    installReportCommand(host.ctx, toolkitGate(), host.settings)
    expect(host.definitions).toEqual([])

    host.setEnabled(true)
    expect(host.definitions).toHaveLength(1)
  })

  it('宿主注销时释放注册，且此后开关不再注册', () => {
    const host = fakeHost({ enable: true })
    installReportCommand(host.ctx, toolkitGate(), host.settings)
    host.teardown()

    expect(host.unregistered).toEqual([COMMAND_REPORT])
    host.setEnabled(false)
    host.setEnabled(true)
    expect(host.definitions).toHaveLength(1)   // 已释放，不再新注册
  })

  it('注册进去的 handler 端到端可用：启用工具 + 续接请求', () => {
    const host = fakeHost({ enable: true })
    const { scope, registered } = fakeScope()
    const agent = fakeAgent(scope)
    const forwarded: Array<{ agent: Agent; text: string }> = []
    const live = {
      id: 's1',
      followup: (message: { content: Array<{ text: string }> }) => {
        forwarded.push({ agent: live as unknown as Agent, text: message.content[0]!.text })
      },
    } as unknown as Agent
    const wired = {
      agents: { get: (id: string) => (id === 's1' ? live : undefined) },
      inject: (host.ctx as unknown as { inject: unknown }).inject,
      effect: (host.ctx as unknown as { effect: unknown }).effect,
    } as unknown as Context
    installReportCommand(wired, toolkitGate(), host.settings)

    const definition = host.definitions[0]!
    void definition.handler({
      agent,
      rawInput: '生成上周周报',
    } as unknown as CommandInvocation)

    expect(registered).toEqual([...DAILY_LOG_TOOL_NAMES])
    expect(forwarded.map((item) => item.text)).toEqual([`生成上周周报\n\n${DAILY_LOG_REFERENCE_TEXT}`])
  })
})
