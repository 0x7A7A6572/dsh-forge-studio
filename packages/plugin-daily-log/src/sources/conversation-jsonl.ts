/**
 * 本地 agent 会话 JSONL 通用解析：claude / codex / dsh 三源共用。
 * 对三种日志的字段名差异做宽容处理（timestamp/ts/created_at、message.role/type）。
 * 只抽取 user / assistant 两类有正文的行，按时间窗过滤。
 *
 * 宿主注入的包裹块（IDE 上下文、环境/权限/技能说明、命令回显、任务通知等）必须剥离：
 * 它们常与真实提问同处一条消息（IDE 场景是"壳块 + 问题块"，Codex 轮首是"AGENTS.md + 环境上下文"），
 * 因此**先剥壳、剥完为空才丢整条** —— 直接丢消息会连带丢掉真问题。
 * 只按白名单标签剥壳，不做通用 <tag> 清除：正文里本就存在 <name>/<args>/<div> 这类
 * 正常尖括号内容（实测中文说明与代码片段里都有），通用清除会误伤。
 */

import type { ActivityEntry, DateRange } from '../types.ts'

/** 宿主注入包裹块的白名单（成对标签整段剥离）。 */
const INJECTED_WRAPPERS = [
  'ide_selection',
  'ide_opened_file',
  'system-reminder',
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-caveat',
  'user-prompt-submit-hook',
  'task-notification',
  'environment_context',
  'INSTRUCTIONS',
  'skills_instructions',
  'collaboration_mode',
  'app-context',
  'permissions',
]

/** 剥壳后的系统提示残留（Codex 把 AGENTS.md 说明与 <INSTRUCTIONS> 放在同一块）。 */
const INJECTED_RESIDUE = /^#?\s*AGENTS\.md instructions$/i

/** 无正文的控制行（不是用户输入）。 */
const SYNTHETIC_USER_LINE = /^\[Request interrupted/i

/** 剥离白名单包裹块，返回剩余正文（已 trim）。 */
export function stripInjectedWrappers(text: string): string {
  let out = text
  for (const tag of INJECTED_WRAPPERS) {
    out = out.replace(new RegExp('<' + tag + '(?:\\s[^>]*)?>[\\s\\S]*?</' + tag + '>', 'g'), '')
  }
  return out.trim()
}

/** 从 message.content（字符串或 ContentBlock 数组）提取纯文本。 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b === null || typeof b !== 'object') return ''
        const o = b as { text?: unknown }
        return typeof o.text === 'string' ? o.text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** 提取消息角色（user / assistant），无法判定返回 undefined。 */
function extractRole(obj: Record<string, unknown>): 'user' | 'assistant' | undefined {
  const msg = (obj.message ?? obj.payload ?? obj) as Record<string, unknown> | undefined
  const role = msg?.role ?? msg?.type ?? obj.type
  if (role === 'user' || role === 'human') return 'user'
  if (role === 'assistant' || role === 'ai') return 'assistant'
  return undefined
}

/** 提取时间戳（epoch ms），无则 0。 */
function extractTs(obj: Record<string, unknown>): number {
  const payload = obj.payload as Record<string, unknown> | undefined
  const raw = obj.timestamp ?? obj.ts ?? obj.created_at ?? payload?.timestamp
  const n = typeof raw === 'string' || typeof raw === 'number' ? Date.parse(String(raw)) : NaN
  return Number.isFinite(n) ? n : 0
}

/** 宿主注入的整条消息（无用户内容）：meta 标记 / 任务通知。 */
function isInjectedMessage(obj: Record<string, unknown>): boolean {
  if (obj.isMeta === true) return true
  const origin = obj.origin as { kind?: unknown } | undefined
  return origin?.kind === 'task-notification'
}

/** 把一条 JSONL 行解析为活动条目（非 user/assistant、无正文、纯注入、窗口外 返回 undefined）。 */
export function parseConversationLine(
  line: string,
  range: DateRange,
  sourceLabel: string,
): ActivityEntry | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return undefined
  }
  const role = extractRole(obj)
  if (role === undefined) return undefined
  if (isInjectedMessage(obj)) return undefined
  const msg = (obj.message ?? obj.payload ?? obj) as Record<string, unknown> | undefined
  const raw = extractText(msg?.content ?? obj.content)
  if (!raw) return undefined
  // 助手输出不剥壳：它可能正当地在讨论这些标签。
  const text = role === 'user' ? stripInjectedWrappers(raw) : raw.trim()
  if (!text) return undefined
  if (role === 'user' && (SYNTHETIC_USER_LINE.test(text) || INJECTED_RESIDUE.test(text))) return undefined
  const ts = extractTs(obj)
  const since = Date.parse(range.since) || 0
  const until = range.until ? Date.parse(range.until) : undefined
  if (ts < since) return undefined
  if (until !== undefined && ts > until) return undefined
  const head = text.replace(/\s+/g, ' ').slice(0, 80)
  return {
    ts,
    sourceLabel,
    kind: 'conversation',
    title: role === 'user' ? `[提问] ${head}` : `[回答] ${head}`,
    body: text,
  }
}
