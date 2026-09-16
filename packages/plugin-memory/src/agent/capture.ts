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
import { MEMORY_LINE_MARKER_PATTERN, MEMORY_RAW_LIMIT, type MemoryService } from '../service.ts'
import type { MemorySettingsAccess } from '../settings.ts'

/** 提炼提示词。 */
export const CAPTURE_PROMPT = [
  '你是记忆提炼器。阅读下面这段对话，只提炼"值得在未来的会话里继续知道"的内容。',
  '',
  '判断标准：',
  '- 值得记：用户明确表达的偏好/纠正/风格要求；用户主动分享的身份与职业信息；项目层面的决策与状态；可复用的经验教训。',
  '- 不要记：临时任务的中间步骤、可从代码直接读出的东西、你的推测、密钥令牌证件号等敏感数据。',
  '- 不要记任务进度与进行中的快照、排查过程的复述、提问与探索细节；可重跑得到的验证结果（测试全过 / tsc 干净 / build 成功）也不要记。',
  '',
  '条数与长度上限（硬性）：最多输出 3 条，每条不超过 200 字、必须是单段纯文本，不要换行、不要列表。宁可少记，不要写长；超出上限的条目会被代码直接丢弃。',
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

/** 单次提炼最多采纳的条目数（模型多给了也只留前 N 条，其余记 too-many）。 */
export const CAPTURE_MAX_ITEMS = 3
/** 单条记忆正文的字符上限（与提示词里的 200 字承诺一致）。 */
export const CAPTURE_MAX_CONTENT_CHARS = 200
/** 单条记忆标题的字符上限。 */
export const CAPTURE_MAX_TITLE_CHARS = 40
/** 进度/状态快照的开头特征词（正文以此开头即视为状态快照）。 */
export const CAPTURE_STATUS_PREFIXES = ['已', '当前', '目前', '正在', '待', '尚未'] as const
/** 进度/状态快照的包含特征词（正文含其一即视为状态快照）。 */
export const CAPTURE_STATUS_MARKERS = [
  '已发布', '已提交', '已合并', '已部署', '进行中', '测试全过', 'tsc 干净', 'build 成功', '正在等',
] as const

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

/**
 * 取会话事件：真实 Session 只有 snapshotEvents()（事件日志的方法，不是属性），
 * 测试替身可能直接给 events。两条都认，都读不到就是空。
 */
function sessionEvents(session: unknown): readonly unknown[] {
  const handle = session as { snapshotEvents?: () => unknown; events?: unknown } | undefined
  if (handle === undefined) return []
  if (typeof handle.snapshotEvents === 'function') {
    const value = handle.snapshotEvents()
    return Array.isArray(value) ? value : []
  }
  return Array.isArray(handle.events) ? handle.events : []
}

/**
 * 助手文本的位置：assistant/message 的事件体是 { turn, step, message, … }，
 * 正文在 message.content；data.content 是早期形状，留作兜底。
 */
function assistantBodyOf(data: Record<string, unknown>): string {
  const fromMessage = textOfContentParts(asRecord(data.message)?.content)
  return fromMessage !== '' ? fromMessage : textOfContentParts(data.content)
}

/**
 * 从会话事件里取最后若干轮「用户问 + 助手答」的纯文本。任何异常返回空串。
 *
 * 只收真人输入（user/message 且 source.kind === 'user'）——agent.inject 塞进来的
 * 合成上下文（文件变更提示、AGENTS.md、技能正文、定时通知、目标续轮）同样是
 * user/message，收进来就是纯噪声。倒着走事件，取满 maxTurns 轮或 maxChars 就停。
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

/** 被代码硬闸门丢弃的一条（原因见 CaptureDropReason）。 */
export interface CaptureDroppedItem {
  readonly title: string
  readonly reason: string
}

/** 丢弃原因：条数超限 / 标题过长 / 正文过长 / 多行排版 / 进度状态快照。 */
export type CaptureDropReason = 'too-many' | 'title-too-long' | 'too-long' | 'multi-line' | 'status-snapshot'

/** 解析结果：采纳的条目 + 被丢弃的条目（丢弃不截断，直接不要）。 */
export interface CaptureParseResult {
  readonly items: CapturedItem[]
  readonly dropped: CaptureDroppedItem[]
}

/** 正文是不是多行 / 列表排版：含换行，或任一行以列表、编号、markdown 标题标记开头。 */
export function isMultiLineContent(text: string): boolean {
  if (/\r\n|\r|\n/.test(text)) return true
  return text.split('\n').some((line) => MEMORY_LINE_MARKER_PATTERN.test(line))
}

/** 正文是不是进度 / 状态快照（以「已 / 当前 / …」开头，或含「已发布 / 进行中 / …」）。 */
export function isStatusSnapshot(text: string): boolean {
  if (CAPTURE_STATUS_PREFIXES.some((prefix) => text.startsWith(prefix))) return true
  return CAPTURE_STATUS_MARKERS.some((marker) => text.includes(marker))
}

/**
 * 解析模型输出为候选记忆；容忍代码块围栏与前后噪声。
 *
 * 这里是**代码级硬闸门**：提示词只是请求，闸门才是保证 —— 条数只留前 3 条，
 * 标题 >40 字、正文 >200 字、多行/列表排版、进度状态快照，全部直接丢弃（不截断），
 * 并连标题与原因一起回报，让审计与日志能解释「这次为什么没记」。
 */
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
    // 条数上限：第 4 条起一律丢弃（不因为它更长/更短而改变判定）。
    if (index >= CAPTURE_MAX_ITEMS) {
      dropped.push({ title, reason: 'too-many' })
      continue
    }
    if (record === undefined) continue
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    // 结构不完整（缺标题或正文）的项静默跳过，不占丢弃清单。
    if (title === '' || content === '') continue
    if (title.length > CAPTURE_MAX_TITLE_CHARS) {
      dropped.push({ title, reason: 'title-too-long' })
      continue
    }
    if (content.length > CAPTURE_MAX_CONTENT_CHARS) {
      dropped.push({ title, reason: 'too-long' })
      continue
    }
    if (isMultiLineContent(content)) {
      dropped.push({ title, reason: 'multi-line' })
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

/**
 * 取一个服务：先走服务注册表（ctx.get），再试属性访问（ctx.llm）。
 * 本插件只声明了部分 inject，属性访问未必看得见别的服务；两条都试，
 * 都没有才算不可用 —— 未声明的服务访问可能直接抛，所以两条都要包 try。
 */
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

/** 当前可用的模型路由；拿不到返回 undefined（本次不提炼 / 不判定）。 */
export function resolveRoute(ctx: Context, session: unknown): { provider: string; model: string } | undefined {
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

/**
 * 频次判定：每 N 个回合提炼一次（N=1 即每轮，等于旧行为）。
 * 拿不到轮次号时兜底为触发 —— 缺一个字段不该把自动提炼整个关掉。
 */
export function shouldCaptureNow(turn: number | undefined, every: number): boolean {
  const n = Number.isFinite(every) ? Math.max(1, Math.floor(every)) : 1
  if (n <= 1) return true
  if (turn === undefined || !Number.isFinite(turn)) return true
  return Math.floor(turn) % n === 0
}

/** 一次提炼的转录窗口与料源（来自面板高级配置）。 */
export interface CaptureOptions {
  readonly maxTurns?: number
  readonly maxChars?: number
  readonly includeAssistant?: boolean
}

/**
 * 一个 turn/end 的完整摄取：留档转录 → 模型抽取 → 写条目 → 记审计。
 *
 * 顺序上有意为之：**先留档，再调模型**。模型不可用、调用失败、输出不可解析，
 * 原文都已经在库里，之后可以对同一份原文重抽（reingest），不会有"这次没记就永远丢了"。
 * 转录按会话归并成一份（后一轮覆盖前一轮，转录本身是累积的），不会越滚越多。
 */
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

  // 2) 模型抽取。拿不到路由 / 没有 llm 服务时到此为止（转录已留档），但**留一条
  //    失败审计**：静默跳过会让「模型觉得不值得记」和「这一步坏了」长得一模一样。
  const route = resolveRoute(ctx, session)
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

  // 2b) 带上「已有的相关记忆标题」当参考：同一条事别另起新标题（同标题会原地合并）。
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
      // 一次性调用走 system 槽（GenerateOptions 的 purpose 是 'compaction' | 'session-title'
      // 的封闭联合，塞自定义值属于越界）。消息形状对齐 dsh-compaction-basic 的既有用法。
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

  // 3) 写条目：解析走代码级硬闸门，被丢弃的项连原因一起进审计与日志。
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
      const config = settings.get()
      if (!config.autoCapture) return
      if (service.isLocked()) return
      const turnValue = asRecord(record.data)?.turn
      const turn = typeof turnValue === 'number' ? turnValue : undefined
      if (!shouldCaptureNow(turn, config.captureEveryTurns)) return
      const id = (session as { id?: unknown } | undefined)?.id
      if (typeof id !== 'string' || id === '' || inFlight.has(id)) return
      inFlight.add(id)
      void captureOne(ctx, service, session, {
        maxTurns: config.captureMaxTurns,
        maxChars: config.captureMaxChars,
        includeAssistant: config.captureIncludeAssistant,
      })
        .catch((error: unknown) => { ctx.logger?.warn?.('[plugin-memory] capture failed: ' + String(error)) })
        .finally(() => { inFlight.delete(id) })
    } catch (error) {
      ctx.logger?.warn?.('[plugin-memory] capture hook failed: ' + String(error))
    }
  })
  return disposer
}
