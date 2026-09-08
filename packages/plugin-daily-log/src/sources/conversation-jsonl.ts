/**
 * 本地 agent 会话 JSONL 通用解析：claude / codex / dsh 三源共用。
 * 对三种日志的字段名差异做宽容处理（timestamp/ts/created_at、message.role/type）。
 * 只抽取 user / assistant 两类有正文的行，按时间窗过滤。
 */

import type { ActivityEntry, DateRange } from '../types.ts'

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

/** 把一条 JSONL 行解析为活动条目（非 user/assistant 或无正文返回 undefined）。 */
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
  const msg = (obj.message ?? obj.payload ?? obj) as Record<string, unknown> | undefined
  const text = extractText(msg?.content ?? obj.content)
  if (!text) return undefined
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
