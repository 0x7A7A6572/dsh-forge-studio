/**
 * 常驻派发器：模型唯一的按需发现入口（本插件其余 15 个工具默认不注册）。
 * 描述必须接住原本散在 15 条工具描述里的「何时该用」信号（spec §5.3），
 * 因此有 220 字符硬预算。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { DAILY_LOG_TOOL_NAMES } from './tools.ts'
import type { ToolGate } from './tool-gate.ts'

export const TOOL_DISPATCHER = 'daily_log'

// 210 字符（硬预算 220）。三段式：能力 → 何时调用 → 解锁什么。
const DESCRIPTION =
  'Enable the daily-log toolkit: work reports from Git commits and local agent conversations. ' +
  'Call first for daily/weekly/monthly reports, recent-work summaries, or work statistics. ' +
  'Unlocks all daily_log_* tools.'

export function createDailyLogDispatcher(gate: ToolGate): ToolDefinition {
  return defineTool({
    name: TOOL_DISPATCHER,
    description: DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          tools: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const result = value as { enabled: boolean; message: string; tools: string[] }
        return [{ type: 'text', text: result.message }]
      },
    },
    execute: async (_args, exec) => {
      const agent = exec.agent
      if (agent === undefined) {
        return {
          enabled: false,
          message: 'Cannot determine the calling session scope. Ask the user to run /report instead.',
          tools: [],
        }
      }
      try {
        const fresh = gate.enable(agent)
        return {
          enabled: true,
          message: fresh
            ? 'Daily-log toolkit enabled for this session.'
            : 'Daily-log toolkit already enabled.',
          tools: [...DAILY_LOG_TOOL_NAMES],
        }
      } catch (error) {
        return {
          enabled: false,
          message: 'Failed to enable the daily-log toolkit: ' + String(error) + '. Ask the user to run /report instead.',
          tools: [],
        }
      }
    },
  })
}
