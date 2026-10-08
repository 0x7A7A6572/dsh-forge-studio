import type { Context } from '@deepseek-ai/cordis'
import { MEMORY_KINDS, type MemoryConfig, type MemoryKind, type MemoryRawId, type MemoryScope } from '../types.ts'
import { MEMORY_RAW_LIMIT, type MemoryService } from '../service.ts'
import type { MemorySettingsAccess } from '../settings.ts'

export const CAPTURE_PROMPT = [
  '你是记忆提炼器。阅读下面这段对话，只提炼"值得在未来的会话里继续知道"的内容。',
  '',
  '判断标准：',
  '- 值得记：用户明确表达的偏好/纠正/风格要求；用户主动分享的身份与职业信息；项目层面的决策与状态；可复用的经验教训。',
  '- 不要记：临时任务的中间步骤、可从代码直接读出的东西、你的推测、密钥令牌证件号等敏感数据。',
  '- 不要记任务进度与进行中的快照、排查过程的复述、提问与探索细节；可重跑得到的验证结果（测试全过 / tsc 干净 / build 成功）也不要记。',
  '',
  '条数与长度上限（硬性）：最多输出 3 条，每条不超过 200 字。可以用换行和 markdown 排版（列表、加粗都行），但只写结论。宁可少记，不要写长；超出上限的条目会被代码直接丢弃。',
  'content 只写结论本身（是什么、为什么这么定、边界在哪），不要写"我排查了…""待验证…"这类叙事；同一主题只输出一条。',
  '只输出「以后还成立」的内容：偏好、纠正、身份、长期决策。以下一律不要输出（会污染记忆库）：发布/提交/安装/收录/部署的进度与状态（如"已发 npm""已合并""正在等 CI"）、本次任务做了什么、临时结论、可从代码或仓库直接读出的东西。',
  '如果这段对话里没有上述「值得记」的内容，直接输出 []。空数组是正常且期望的结果，不要为了凑数而记。',
  '',
  '作用域判定：换到任何项目都成立 → global；只对某个工作区成立 → project。',
  '',
  '输出一个 JSON 数组，不要任何多余文字（不要 Markdown 代码块）。每个元素：',
  '{ "title": "短而唯一的标题", "content": "用用户原本的表述记录内容", "kind": "preference|user|project|decision|fact|history", "scope": "global|project" }',
  '',
  '没有值得记的内容就输出 []。',
].join('\n')

export const CAPTURE_MAX_ITEMS = 3
export const CAPTURE_MAX_CONTENT_CHARS = 200
export const CAPTURE_MAX_TITLE_CHARS = 40
export const CAPTURE_STATUS_PREFIXES = ['已', '当前', '目前', '正在', '待', '尚未'] as const
export const CAPTURE_STATUS_MARKERS = [
  '已发布', '已提交', '已合并', '已部署', '进行中', '测试全过', 'tsc 干净', 'build 成功', '正在等',
] as const

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

/** 只认显式出现的用量数字，读不到就缺省，绝不估算。 */
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 真实 Session 只有 snapshotEvents() 方法；测试替身可能直接给 events。 */
function sessionEvents(session: unknown): readonly unknown[] {
  const handle = session as { snapshotEvents?: () => unknown; events?: unknown } | undefined
  if (handle === undefined) return []
  if (typeof handle.snapshotEvents === 'function') {
    const value = handle.snapshotEvents()
    return Array.isArray(value) ? value : []
  }
  return Array.isArray(handle.events) ? handle.events : []
}

function assistantBodyOf(data: Record<string, unknown>): string {
  const fromMessage = textOfContentParts(asRecord(data.message)?.content)
  return fromMessage !== '' ? fromMessage : textOfContentParts(data.content)
}

/**
 * 只收真人输入：agent.inject 塞进来的合成上下文同样是 user/message，收进来是噪声。
 */
export function collectTranscript(session: unknown, maxTurns = 12, maxChars = 12000, includeAssistant = true): string {
  try {
    const events = sessionEvents(session)
    if (events.length === 0) return ''
    const blocks: string[] = []
    let pending: string[] = []
    let chars = 0
    let turns = 0
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = asRecord(events[index])
      if (event === undefined) continue
      const type = event.type
      if (typeof type !== 'string') continue
      const data = asRecord(event.data)
      if (data === undefined) continue
      if (type === 'assistant/message') {
        if (!includeAssistant) continue
        const body = assistantBodyOf(data)
        if (body !== '') pending.unshift(body)
        continue
      }
      if (type !== 'user/message') continue
      const kind = asRecord(data.source)?.kind
      if (kind !== undefined && kind !== 'user') continue
      const body = textOfContentParts(data.content)
      if (body === '') continue
      const lines = ['用户：' + body]
      if (pending.length > 0) lines.push('助手：' + pending.join('\n'))
      const block = lines.join('\n')
      blocks.unshift(block)
      pending = []
      chars += block.length
      turns += 1
      if (turns >= maxTurns || chars >= maxChars) break
    }
    const joined = blocks.join('\n\n')
    return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined
  } catch {
    return ''
  }
}

export interface CaptureDroppedItem {
  readonly title: string
  readonly reason: string
}

export type CaptureDropReason = 'too-many' | 'title-too-long' | 'too-long' | 'status-snapshot'

export interface CaptureParseResult {
  readonly items: CapturedItem[]
  readonly dropped: CaptureDroppedItem[]
}


export function isStatusSnapshot(text: string): boolean {
  if (CAPTURE_STATUS_PREFIXES.some((prefix) => text.startsWith(prefix))) return true
  return CAPTURE_STATUS_MARKERS.some((marker) => text.includes(marker))
}

/** 超限与状态快照一律整条丢弃，不截断。 */
export function parseCapturedItems(text: string): CaptureParseResult {
  const trimmed = text.trim()
  if (trimmed === '') return { items: [], dropped: [] }
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return { items: [], dropped: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return { items: [], dropped: [] }
  }
  if (!Array.isArray(parsed)) return { items: [], dropped: [] }
  const items: CapturedItem[] = []
  const dropped: CaptureDroppedItem[] = []
  for (let index = 0; index < parsed.length; index += 1) {
    const record = asRecord(parsed[index])
    const title = record !== undefined && typeof record.title === 'string' ? record.title.trim() : ''
    if (index >= CAPTURE_MAX_ITEMS) {
      dropped.push({ title, reason: 'too-many' })
      continue
    }
    if (record === undefined) continue
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    if (title === '' || content === '') continue
    if (title.length > CAPTURE_MAX_TITLE_CHARS) {
      dropped.push({ title, reason: 'title-too-long' })
      continue
    }
    if (content.length > CAPTURE_MAX_CONTENT_CHARS) {
      dropped.push({ title, reason: 'too-long' })
      continue
    }
    if (isStatusSnapshot(content)) {
      dropped.push({ title, reason: 'status-snapshot' })
      continue
    }
    const kind = MEMORY_KINDS.includes(record.kind as MemoryKind) ? (record.kind as MemoryKind) : 'fact'
    const scope: MemoryScope = record.scope === 'project' ? 'project' : 'global'
    items.push({ title, content, kind, scope })
  }
  return { items, dropped }
}

/** 未声明的服务访问可能直接抛，所以 ctx.get 与属性访问两条都要包 try。 */
export function serviceOf<T>(ctx: Context, name: string): T | undefined {
  try {
    const viaGet = (ctx as unknown as { get?: (key: string) => unknown }).get?.(name)
    if (viaGet !== undefined && viaGet !== null) return viaGet as T
  } catch { /* 落到属性访问 */ }
  try {
    const viaProp = (ctx as unknown as Record<string, unknown>)[name]
    if (viaProp !== undefined && viaProp !== null) return viaProp as T
  } catch { /* 没有这个服务 */ }
  return undefined
}

export function configuredRoute(
  config: Pick<MemoryConfig, 'llmProvider' | 'llmModel'>,
): { provider: string; model: string } | undefined {
  const provider = (config.llmProvider ?? '').trim()
  const model = (config.llmModel ?? '').trim()
  return provider !== '' && model !== '' ? { provider, model } : undefined
}

export function resolveRoute(
  ctx: Context,
  session: unknown,
  preferred?: { provider: string; model: string },
): { provider: string; model: string } | undefined {
  if (preferred !== undefined && preferred.provider !== '' && preferred.model !== '') return preferred
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
    const selection = serviceOf<{ currentSelection?: () => unknown }>(ctx, 'agentDefaultModel')
      ?.currentSelection?.()
    const record = asRecord(selection)
    const provider = record?.provider
    const model = record?.model
    if (typeof provider === 'string' && typeof model === 'string' && provider !== '' && model !== '') {
      return { provider, model }
    }
  } catch { /* 无路由 */ }
  return undefined
}

export function shouldCaptureNow(turn: number | undefined, every: number): boolean {
  const n = Number.isFinite(every) ? Math.max(1, Math.floor(every)) : 1
  if (n <= 1) return true
  if (turn === undefined || !Number.isFinite(turn)) return true
  return Math.floor(turn) % n === 0
}

export interface CaptureOptions {
  readonly maxTurns?: number
  readonly maxChars?: number
  readonly includeAssistant?: boolean
  readonly route?: { readonly provider: string; readonly model: string }
}

/** 有意先留档再调模型：抽取失败原文仍在，可对同一份重抽。 */
export async function captureOne(
  ctx: Context,
  service: MemoryService,
  session: unknown,
  options: CaptureOptions = {},
): Promise<void> {
  const transcript = collectTranscript(
    session,
    options.maxTurns ?? 12,
    options.maxChars ?? 12000,
    options.includeAssistant ?? true,
  )
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

  const route = resolveRoute(ctx, session, options.route)
  const llm = serviceOf<{ stream?: (options: unknown) => AsyncIterable<unknown> }>(ctx, 'llm')
  if (route === undefined || llm?.stream === undefined) {
    const reason = route === undefined ? '拿不到模型路由，本次未提炼' : 'llm 服务不可用，本次未提炼'
    ctx.logger?.warn?.('[plugin-memory] capture skipped: ' + reason)
    try {
      await service.recordAudit({
        kind: 'capture',
        provider: route?.provider ?? 'unknown',
        model: route?.model ?? 'unknown',
        ok: false,
        durationMs: 0,
        inputChars: transcript.length,
        outputChars: 0,
        recordIds: [],
        ...(rawId !== undefined ? { rawId } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        error: reason,
      })
    } catch (error) {
      ctx.logger?.warn?.('[plugin-memory] capture audit skipped: ' + errorText(error))
    }
    return
  }

  let systemText = CAPTURE_PROMPT
  try {
    const titles = service.overlapTitleHints(cwd)
    if (titles.length > 0) {
      systemText = CAPTURE_PROMPT + '\n' + [
        '参考：这个用户已有的相关记忆标题如下。如果本次内容与其中之一是同一件事，不要另起新标题 —— 要么直接跳过不输出，要么用上面完全相同的标题输出（同标题会就地合并）。',
        '- ' + titles.join('\n- '),
      ].join('\n')
    }
  } catch (error) {
    ctx.logger?.warn?.('[plugin-memory] capture title hints skipped: ' + errorText(error))
  }

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
      // 自定义 purpose 越界（封闭联合），提示词只能走 system 槽。
      system: systemText,
      maxTokens: 2048,
      signal: controller.signal,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: transcript }],
          source: { kind: 'plugin', plugin: '@zzerx/dsh-plugin-memory' },
        },
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

  const parsed: CaptureParseResult = failure === undefined
    ? parseCapturedItems(text)
    : { items: [], dropped: [] }
  const items = parsed.items
  const dropped = parsed.dropped
  if (dropped.length > 0) {
    ctx.logger?.warn?.('[plugin-memory] capture dropped ' + dropped.length + ' item(s): '
      + dropped.map((entry) => entry.reason + (entry.title === '' ? '' : '「' + entry.title + '」')).join('、'))
  }
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
      ...(dropped.length > 0 ? { dropped } : {}),
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
      const config = settings.get()
      if (!config.autoCapture) return
      if (service.isLocked()) return
      const turnValue = asRecord(record.data)?.turn
      const turn = typeof turnValue === 'number' ? turnValue : undefined
      if (!shouldCaptureNow(turn, config.captureEveryTurns)) return
      const id = (session as { id?: unknown } | undefined)?.id
      if (typeof id !== 'string' || id === '' || inFlight.has(id)) return
      inFlight.add(id)
      const route = configuredRoute(config)
      void captureOne(ctx, service, session, {
        maxTurns: config.captureMaxTurns,
        maxChars: config.captureMaxChars,
        includeAssistant: config.captureIncludeAssistant,
        ...(route !== undefined ? { route } : {}),
      })
        .catch((error: unknown) => { ctx.logger?.warn?.('[plugin-memory] capture failed: ' + String(error)) })
        .finally(() => { inFlight.delete(id) })
    } catch (error) {
      ctx.logger?.warn?.('[plugin-memory] capture hook failed: ' + String(error))
    }
  })
  return disposer
}
