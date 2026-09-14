/**
 * 自动生成对话记忆 —— 面板开关「生成对话记忆」= settings.autoCapture。
 *
 * 每个 turn/end 用会话自己的模型（或 agentDefaultModel 的当前选择）提炼这一次对话里
 * 值得长期记住的内容，写进记忆库。全程 fail-safe：拿不到模型路由、流失败、JSON 非法、
 * 单条字段不合法，都只降级为「这次没记」，绝不干扰对话本身。
 *
 * 提炼结果是 JSON 数组，每项 {title, content, kind, scope}；scope 由模型判定，
 * project 项的工作区目录由 host 用会话 cwd 兜底填上（模型不需要知道路径）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { MEMORY_KINDS, type MemoryKind, type MemoryRawId, type MemoryScope } from '../types.ts'
import { MEMORY_RAW_LIMIT, type MemoryService } from '../service.ts'
import type { MemorySettingsAccess } from '../settings.ts'

/** 提炼提示词。 */
export const CAPTURE_PROMPT = [
  '你是记忆提炼器。阅读下面这段对话，只提炼"值得在未来的会话里继续知道"的内容。',
  '',
  '判断标准：',
  '- 值得记：用户明确表达的偏好/纠正/风格要求；用户主动分享的身份与职业信息；项目层面的决策与状态；可复用的经验教训。',
  '- 不要记：临时任务的中间步骤、可从代码直接读出的东西、你的推测、密钥令牌证件号等敏感数据。',
  '',
  '作用域判定：换到任何项目都成立 → global；只对某个工作区成立 → project。',
  '',
  '输出一个 JSON 数组，不要任何多余文字（不要 Markdown 代码块）。每个元素：',
  '{ "title": "短而唯一的标题", "content": "用用户原本的表述记录内容", "kind": "preference|user|project|decision|fact|history", "scope": "global|project" }',
  '',
  '没有值得记的内容就输出 []。',
].join('\n')

/** 提炼出的一条候选记忆。 */
export interface CapturedItem {
  readonly title: string
  readonly content: string
  readonly kind: MemoryKind
  readonly scope: MemoryScope
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function textOfContentParts(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const parts: string[] = []
  for (const part of value) {
    if (typeof part === 'string') parts.push(part)
    else {
      const record = asRecord(part)
      const text = record?.text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

/**
 * 从流式分片里读 token 用量。各家 provider 字段名不一（inputTokens / promptTokens /
 * input_tokens），这里只认显式出现的数字 —— 读不到就缺省，绝不估算。
 */
export function readUsage(chunk: unknown): { inputTokens?: number; outputTokens?: number } {
  const usage = asRecord(asRecord(chunk)?.usage)
  if (usage === undefined) return {}
  const input = usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.prompt_tokens
  const output = usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.completion_tokens
  return {
    ...(typeof input === 'number' && Number.isFinite(input) ? { inputTokens: input } : {}),
    ...(typeof output === 'number' && Number.isFinite(output) ? { outputTokens: output } : {}),
  }
}

/** 异常转可读文本（审计里的 error 字段）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 从会话事件里取最后若干轮「用户问 + 助手答」的纯文本。任何异常返回空串。 */
export function collectTranscript(session: unknown, maxTurns = 12, maxChars = 12000): string {
  try {
    const events = (session as { events?: unknown } | undefined)?.events
    if (!Array.isArray(events) || events.length === 0) return ''
    const turns: string[] = []
    for (const raw of events) {
      const event = asRecord(raw)
      if (event === undefined) continue
      const type = event.type
      if (typeof type !== 'string') continue
      const data = asRecord(event.data)
      if (data === undefined) continue
      const source = asRecord(data.source)
      const kind = source?.kind
      const body = textOfContentParts(data.content)
      if (body === '') continue
      if (type === 'user/message' && (kind === undefined || kind === 'user')) {
        turns.push('用户：' + body)
        continue
      }
      if (kind === 'assistant' || type.includes('assistant')) {
        turns.push('助手：' + body)
      }
    }
    const joined = turns.join('\n\n')
    return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined
  } catch {
    return ''
  }
}

/** 解析模型输出为候选记忆；容忍代码块围栏与前后噪声。非法项直接丢弃。 */
export function parseCapturedItems(text: string): CapturedItem[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const items: CapturedItem[] = []
  for (const raw of parsed) {
    const record = asRecord(raw)
    if (record === undefined) continue
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    if (title === '' || content === '') continue
    const kind = MEMORY_KINDS.includes(record.kind as MemoryKind) ? (record.kind as MemoryKind) : 'fact'
    const scope: MemoryScope = record.scope === 'project' ? 'project' : 'global'
    items.push({ title, content, kind, scope })
    if (items.length >= 8) break
  }
  return items
}

/** 当前可用的模型路由；拿不到返回 undefined（本次不提炼）。 */
function resolveRoute(ctx: Context, session: unknown): { provider: string; model: string } | undefined {
  try {
    const header = (session as { requestHeader?: () => unknown } | undefined)?.requestHeader?.()
    const config = asRecord(asRecord(header)?.config)
    const provider = config?.provider
    const model = config?.model
    if (typeof provider === 'string' && typeof model === 'string' && provider !== '' && model !== '') {
      return { provider, model }
    }
  } catch { /* 落到 agentDefaultModel */ }
  try {
    const selection = (ctx as unknown as { agentDefaultModel?: { currentSelection?: () => unknown } })
      .agentDefaultModel?.currentSelection?.()
    const record = asRecord(selection)
    const provider = record?.provider
    const model = record?.model
    if (typeof provider === 'string' && typeof model === 'string' && provider !== '' && model !== '') {
      return { provider, model }
    }
  } catch { /* 无路由 */ }
  return undefined
}

/**
 * 一个 turn/end 的完整摄取：留档转录 → 模型抽取 → 写条目 → 记审计。
 *
 * 顺序上有意为之：**先留档，再调模型**。模型不可用、调用失败、输出不可解析，
 * 原文都已经在库里，之后可以对同一份原文重抽（reingest），不会有"这次没记就永远丢了"。
 * 转录按会话归并成一份（后一轮覆盖前一轮，转录本身是累积的），不会越滚越多。
 */
async function captureOne(ctx: Context, service: MemoryService, session: unknown): Promise<void> {
  const transcript = collectTranscript(session)
  if (transcript.length < 80) return
  const id = (session as { id?: unknown } | undefined)?.id
  const sessionId = typeof id === 'string' && id !== '' ? id : undefined
  const cwd = (() => {
    try {
      const value = (session as { header?: { cwd?: unknown } } | undefined)?.header?.cwd
      return typeof value === 'string' && value.trim() !== '' ? value : undefined
    } catch {
      return undefined
    }
  })()

  // 1) 原文留档（不依赖模型是否可用）。
  let rawId: MemoryRawId | undefined
  try {
    const raw = await service.storeRawDocument({
      text: transcript,
      origin: 'capture',
      scope: cwd === undefined ? 'global' : 'project',
      ...(cwd !== undefined ? { projectPath: cwd } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      note: 'turn/end 对话转录',
    })
    rawId = raw.id
  } catch (error) {
    ctx.logger?.warn?.('[plugin-memory] capture archive skipped: ' + errorText(error))
  }

  // 2) 模型抽取（拿不到路由 / 没有 llm 服务就到此为止，转录已留档）。
  const route = resolveRoute(ctx, session)
  if (route === undefined) return
  const llm = (ctx as unknown as { llm?: { stream?: (options: unknown) => AsyncIterable<unknown> } }).llm
  if (llm?.stream === undefined) return

  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 60_000)
  let text = ''
  let failure: string | undefined
  let tokensIn: number | undefined
  let tokensOut: number | undefined
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      purpose: 'memory-capture',
      maxTokens: 2048,
      signal: controller.signal,
      messages: [
        { role: 'system', content: [{ type: 'text', text: CAPTURE_PROMPT }] },
        { role: 'user', content: [{ type: 'text', text: transcript }] },
      ],
    })
    for await (const raw of stream) {
      const chunk = asRecord(raw)
      if (chunk === undefined) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      const usage = readUsage(chunk)
      if (usage.inputTokens !== undefined) tokensIn = usage.inputTokens
      if (usage.outputTokens !== undefined) tokensOut = usage.outputTokens
      if (chunk.type === 'finish') {
        const reason = asRecord(chunk.reason)
        const kind = reason?.kind ?? chunk.kind
        if (kind === 'error' || kind === 'aborted') failure = 'stream ' + String(kind)
      }
    }
  } catch (error) {
    failure = errorText(error)
  } finally {
    clearTimeout(timer)
  }

  // 3) 写条目。
  const items = failure === undefined ? parseCapturedItems(text) : []
  const recordIds: string[] = []
  for (const item of items) {
    if (item.scope === 'project' && cwd === undefined) continue
    try {
      const saved = await service.save({
        title: item.title,
        content: item.content,
        kind: item.kind,
        scope: item.scope,
        ...(item.scope === 'project' && cwd !== undefined ? { projectPath: cwd } : {}),
        importance: 3,
        source: 'capture',
        ...(sessionId !== undefined ? { sessionId } : {}),
      })
      recordIds.push(saved.id)
    } catch (error) {
      ctx.logger?.warn?.('[plugin-memory] capture save skipped: ' + errorText(error))
    }
  }
  if (rawId !== undefined && recordIds.length > 0) {
    try {
      await service.markExtracted(rawId, recordIds)
    } catch (error) {
      ctx.logger?.warn?.('[plugin-memory] capture link skipped: ' + errorText(error))
    }
  }

  // 4) 审计这次后台调用（读不到用量就缺省）。
  try {
    await service.recordAudit({
      kind: 'capture',
      provider: route.provider,
      model: route.model,
      ok: failure === undefined,
      durationMs: Date.now() - startedAt,
      inputChars: transcript.length,
      outputChars: text.length,
      ...(tokensIn !== undefined ? { tokensIn } : {}),
      ...(tokensOut !== undefined ? { tokensOut } : {}),
      recordIds,
      ...(rawId !== undefined ? { rawId } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(failure !== undefined ? { error: failure } : {}),
    })
  } catch (error) {
    ctx.logger?.warn?.('[plugin-memory] capture audit skipped: ' + errorText(error))
  }

  try {
    await service.pruneRawDocuments(MEMORY_RAW_LIMIT)
  } catch { /* 清理失败不影响本次结果 */ }

  if (recordIds.length > 0) ctx.logger?.info?.('[plugin-memory] captured ' + recordIds.length + ' memory item(s)')
  else if (failure !== undefined) ctx.logger?.warn?.('[plugin-memory] capture extraction failed: ' + failure)
}

/**
 * 挂上 turn/end 提炼钩子。返回 disposer。
 * 开关关闭、会话重复触发、模型不可用、提炼失败 —— 全部静默降级。
 */
export function installMemoryCapture(
  ctx: Context,
  service: MemoryService,
  settings: MemorySettingsAccess,
): () => void {
  const inFlight = new Set<string>()
  const disposer = ctx.on('session/event', (session: unknown, event: unknown) => {
    try {
      const record = asRecord(event)
      if (record?.type !== 'turn/end') return
      if (!settings.get().autoCapture) return
      if (service.isLocked()) return
      const id = (session as { id?: unknown } | undefined)?.id
      if (typeof id !== 'string' || id === '' || inFlight.has(id)) return
      inFlight.add(id)
      void captureOne(ctx, service, session)
        .catch((error: unknown) => { ctx.logger?.warn?.('[plugin-memory] capture failed: ' + String(error)) })
        .finally(() => { inFlight.delete(id) })
    } catch (error) {
      ctx.logger?.warn?.('[plugin-memory] capture hook failed: ' + String(error))
    }
  })
  return disposer
}
