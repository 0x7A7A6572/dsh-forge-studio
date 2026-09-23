/**
 * 写入判定（方案 C）：把「这条是不是已经有了」交给模型判一次。
 *
 * 为什么需要它：标题相同、别名命中、字符 Dice 重叠这三道闸门都只能看字面。
 * 换一套说法写同一条事，Dice 可能只有 0.2~0.5 —— 阈值抬到能自动合并就会误并，
 * 不抬就漏。判定只在「附近确实有条像的」时发起（服务端的 MEMORY_JUDGE_FLOOR
 * 兜底），一次最多带 3 条候选、输出一行 JSON、约 200 token。
 *
 * 失败一律退化成「新建」：拿不到路由、超时、返回不可解析、targetId 不在候选里，
 * 都当作没有判定 —— 宁可多留一条记忆，也不要因为判定失败丢掉新信息。
 */

import type { Context } from '@deepseek-ai/cordis'
import { readUsage, resolveRoute, serviceOf } from './capture.ts'
import type { MemoryId } from '../types.ts'
import type { MemoryJudge, MemoryJudgeVerdict } from '../service.ts'

/** 判定提示词：只输出一行 JSON，拿不准一律 add。 */
export const JUDGE_PROMPT = [
  '你是记忆库的去重判定器。给你一条「待写入的记忆」和若干条「已有记忆」（按相似度从高到低），判断待写入的是不是已经被覆盖。',
  '只输出一行 JSON，不要解释、不要 markdown 代码块：',
  '{"decision":"add|update|skip","targetId":"<已有记忆的 id>","reason":"<不超过 30 字>"}',
  'decision 的含义：',
  'add = 新信息，两条都要留下（这是拿不准时的默认选择）；',
  'update = 说的是同一件事，可以互相改写或补充，应该并进 targetId 那一条；',
  'skip = 已有那条已经完整覆盖，待写入的不带任何新信息，不必记。',
  'update / skip 必须给出候选列表里真实存在的 targetId；候选都不合适就 add。',
].join('\n')

/** 输出上限：一行 JSON，给足余量即可。 */
export const JUDGE_MAX_TOKENS = 256
/** 单次判定超时：超了就退化成「新建」，不能拖住写入。 */
export const JUDGE_TIMEOUT_MS = 15000
/** 候选正文截断长度（判定看语义，不需要全文）。 */
export const JUDGE_MAX_CANDIDATE_CHARS = 200
/** reason 截断长度。 */
export const JUDGE_MAX_REASON_CHARS = 60

/** 判定结果里的 meta（服务端据此记审计）。 */
export interface JudgeMeta {
  readonly ok: boolean
  readonly provider: string
  readonly model: string
  readonly durationMs: number
  readonly inputChars: number
  readonly outputChars: number
  readonly tokensIn?: number
  readonly tokensOut?: number
  readonly error?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * 解析判定输出：容忍代码块与前后废话，取第一个 { 到最后一个 }。
 * update / skip 的 targetId 必须在候选里，否则整条判定作废（退回新建）。
 */
export function parseJudgeVerdict(
  text: string,
  candidateIds: readonly string[],
): { decision: 'add' | 'update' | 'skip'; targetId?: MemoryId; reason?: string } | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced !== null ? fenced[1]! : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(body.slice(start, end + 1))
  } catch {
    return undefined
  }
  const record = asRecord(raw)
  if (record === undefined) return undefined
  const decision = record.decision
  if (decision !== 'add' && decision !== 'update' && decision !== 'skip') return undefined
  const rawTarget = record.targetId ?? record.target_id
  const targetId = typeof rawTarget === 'string' && candidateIds.includes(rawTarget) ? rawTarget : undefined
  // update / skip 认不出目标就作废：宁可新建，也不要并错一条。
  if (decision !== 'add' && targetId === undefined) return undefined
  const rawReason = typeof record.reason === 'string' ? record.reason.trim() : ''
  const reason = rawReason === '' ? undefined : rawReason.slice(0, JUDGE_MAX_REASON_CHARS)
  // targetId 已经在候选列表里比对过，它本来就是某个 MemoryRecord 的 id，这里补回品牌类型。
  return { decision, ...(targetId !== undefined ? { targetId: targetId as MemoryId } : {}), ...(reason !== undefined ? { reason } : {}) }
}

/** 判定入参拼成一段文本（纯文本，不塞 JSON —— 候选正文里本来就可能有大括号）。 */
export function renderJudgeInput(request: {
  readonly title: string
  readonly content: string
  readonly summary: string
  readonly candidates: readonly { readonly id: string; readonly kind: string; readonly title: string; readonly content: string; readonly score: number }[]
}): string {
  const lines = ['待写入的记忆：', '标题：' + request.title]
  if (request.summary !== '') lines.push('摘要：' + request.summary)
  lines.push('正文：' + request.content, '', '已有记忆（相似度从高到低）：')
  for (const candidate of request.candidates) {
    const body = candidate.content.length > JUDGE_MAX_CANDIDATE_CHARS
      ? candidate.content.slice(0, JUDGE_MAX_CANDIDATE_CHARS) + '…'
      : candidate.content
    lines.push('[' + candidate.id + '] ' + candidate.kind + ' / ' + candidate.title
      + '（相似度 ' + candidate.score.toFixed(2) + '）', body, '')
  }
  return lines.join('\n')
}

/**
 * 造一个判定钩子。调用时现取路由与 llm 服务；任何一环拿不到就返回 undefined
 * （服务端视作「没有判定」，退回阈值判定 + 疑似提示，且不记审计）。
 *
 * 路由优先级同提炼：面板指定的后台模型 > agentDefaultModel 的当前选择。
 * 判定钩子是最先需要「用便宜模型跑后台活」的场景 —— 它每次写入都可能触发。
 */
export function createMemoryJudge(
  ctx: Context,
  options?: {
    readonly timeoutMs?: number
    /** 面板指定的后台模型取值器（每次判定现取，改设置即时生效）。 */
    readonly route?: () => { readonly provider: string; readonly model: string } | undefined
  },
): MemoryJudge {
  const timeoutMs = options?.timeoutMs ?? JUDGE_TIMEOUT_MS
  const preferredRoute = options?.route
  return async (request) => {
    let preferred: { provider: string; model: string } | undefined
    try {
      preferred = preferredRoute?.()
    } catch {
      preferred = undefined
    }
    const route = resolveRoute(ctx, undefined, preferred)
    const llm = serviceOf<{ stream?: (options: unknown) => AsyncIterable<unknown> }>(ctx, 'llm')
    if (route === undefined || llm?.stream === undefined) return undefined
    const payload = renderJudgeInput(request)
    const controller = new AbortController()
    const started = Date.now()
    let text = ''
    let failure: string | undefined
    let tokensIn: number | undefined
    let tokensOut: number | undefined
    const run = (async (): Promise<MemoryJudgeVerdict> => {
      try {
        const stream = llm.stream!({
          provider: route.provider,
          model: route.model,
          system: JUDGE_PROMPT,
          maxTokens: JUDGE_MAX_TOKENS,
          signal: controller.signal,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: payload }],
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
        failure = error instanceof Error ? error.message : String(error)
      }
      const meta = {
        ok: failure === undefined,
        provider: route.provider,
        model: route.model,
        durationMs: Date.now() - started,
        inputChars: payload.length,
        outputChars: text.length,
        ...(tokensIn !== undefined ? { tokensIn } : {}),
        ...(tokensOut !== undefined ? { tokensOut } : {}),
        ...(failure !== undefined ? { error: failure } : {}),
      }
      if (failure !== undefined) {
        return { decision: 'add', reason: '判定调用失败：' + failure, meta }
      }
      const parsed = parseJudgeVerdict(text, request.candidates.map((candidate) => candidate.id))
      if (parsed === undefined) {
        return { decision: 'add', reason: '判定输出无法解析', meta: { ...meta, ok: false, error: 'invalid judge output' } }
      }
      return { ...parsed, meta }
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<MemoryJudgeVerdict>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve({
          decision: 'add',
          reason: '判定超时',
          meta: {
            ok: false, provider: route.provider, model: route.model,
            durationMs: Date.now() - started, inputChars: payload.length, outputChars: 0,
            error: 'judge timeout after ' + String(timeoutMs) + 'ms',
          },
        })
      }, timeoutMs)
    })
    try {
      return await Promise.race([run, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
