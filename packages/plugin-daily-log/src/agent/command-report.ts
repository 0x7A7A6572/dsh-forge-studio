/**
 * /report 斜杠指令：把整组 daily_log_* 工具（含详细引导段）注入当前会话的 agent scope。
 *
 * 指令名只能是英文小写（宿主 parseCommand 的 COMMAND_NAME 为 /^[a-z][a-z0-9_-]*$/u），
 * 但 description 是给人看的，用中文。
 *
 * 关键事实（源码证实）：宿主执行 handler 时**不会**把指令发给模型 ——
 * CommandDefinition 的原话是 'Execute against the receiving agent without sending the command
 * to the model'。所以「启用」之后必须自己把请求续给模型，否则用户敲完 /report 只会收到一句
 * 回复、拿不到报告。续接参照 packages/acp/acp/src/session.ts:291-299：
 * createUserMessage({ content, source: { kind: 'user' } }) 之后调 agent.followup(message)。
 * 消息一律走官方工厂 @deepseek-ai/dsh-llm 的 createUserMessage（不再本地拼装）。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { DAILY_LOG_TOOL_NAMES } from './tools.ts'
import type { ToolGate } from './tool-gate.ts'
import type { DailyLogSettingsAccess } from '../settings.ts'

export const COMMAND_REPORT = 'report'

/** 指令描述与输入提示（给人看，中文）。 */
export const REPORT_COMMAND_DESCRIPTION = '启用工作报告能力：扫描 Git 提交与本地 agent 对话，生成日报 / 周报 / 月报'
export const REPORT_COMMAND_HINT = '[需求描述]'

/** 把用户原始请求续给 agent，产生一次模型轮次；无此能力时返回 false。 */
export interface ReportForwarder {
  forward(agent: Agent, text: string): boolean
}

interface ReportInvocation {
  readonly agent: Agent
  readonly rawInput: string
}

interface ReportResult {
  readonly kind: 'success' | 'error'
  readonly text: string
}

/**
 * 纯函数：便于单测，不依赖 cordis。
 * 顺序固定为「先启用、后续接」—— 启用失败时绝不续接（否则模型会在没有工具的情况下开工）。
 */
export function handleReportCommand(
  gate: ToolGate,
  forwarder: ReportForwarder,
  invocation: ReportInvocation,
): ReportResult {
  let freshlyEnabled: boolean
  try {
    freshlyEnabled = gate.enable(invocation.agent)
  } catch (error) {
    return { kind: 'error', text: '启用工作报告能力失败：' + String(error) }
  }
  const lead = freshlyEnabled ? '已启用工作报告能力' : '工作报告能力已处于启用状态'
  const text = (invocation.rawInput ?? '').trim()
  if (text === '') {
    return {
      kind: 'success',
      text: lead + '，本轮可用 ' + DAILY_LOG_TOOL_NAMES.length + ' 个工具。把需求告诉我即可，例如「生成上周周报」。',
    }
  }
  return forwarder.forward(invocation.agent, text)
    ? { kind: 'success', text: lead + '，正在按你的要求生成。' }
    : { kind: 'success', text: lead + '，但没能自动继续你的请求 —— 请把需求再说一次。' }
}

/** 真实续接实现：按 id 取运行时 agent（公开类型只有 id），投一条 user followup。 */
export function createReportForwarder(ctx: Context): ReportForwarder {
  return {
    forward(agent, text) {
      const live = ctx.agents.get(agent.id)
      if (live === undefined) return false
      try {
        live.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      } catch {
        return false   // driver 已收敛/已释放：如实回报「没能自动续接」
      }
      return true
    },
  }
}

/** 指令注册（开关为真时注册，否则注销）。 */
function registerReportCommand(
  ctx: Context,
  gate: ToolGate,
  forwarder: ReportForwarder,
): () => void {
  const definition: CommandDefinition = {
    name: COMMAND_REPORT,
    description: REPORT_COMMAND_DESCRIPTION,
    input: { hint: REPORT_COMMAND_HINT },
    handler: (invocation) => handleReportCommand(gate, forwarder, invocation),
  }
  return ctx.commands.register(definition)
}

/**
 * 按开关注册/注销指令；settings 的 live 变更即时生效。
 * 期望状态每次都从 settings.get() 现算 —— 不看 ready()：bind() 的首次 publish 期间
 * ready() 仍为 false，用它做门会让初始状态丢失。
 */
export function installReportCommand(
  ctx: Context,
  gate: ToolGate,
  settings: DailyLogSettingsAccess,
): void {
  const forwarder = createReportForwarder(ctx)
  ctx.inject(['commands'], (commandCtx) => {
    let release: (() => void) | undefined
    let closed = false
    const sync = (): void => {
      if (closed) return
      const wanted = settings.get().enableReportCommand
      if (wanted && release === undefined) {
        release = registerReportCommand(commandCtx, gate, forwarder)
      } else if (!wanted && release !== undefined) {
        release()
        release = undefined
      }
    }
    sync()
    ctx.effect(() => settings.watch(() => sync()))
    ctx.effect(() => () => {
      closed = true
      release?.()
      release = undefined
    })
  })
}
