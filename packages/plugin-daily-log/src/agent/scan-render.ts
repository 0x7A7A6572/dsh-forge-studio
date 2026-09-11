/**
 * 扫描结果分层渲染。
 *
 * 问题：会话渠道逐条产出（实测 hake_app_2.0 一周 365 条），全量渲染必然撑爆上下文；
 * 而"截断前 N 条"会让后半段静默消失，写报告时误判为"没干活"。
 * 口径：行数 ∝ 分组数（会话 / 分支），与消息条数无关 —— 默认 index 只给索引，
 * summary 补每条分组的"首问 + 末答"，raw 才是逐条明细。
 * 折叠必须显式：被省略的分组要列出名称与条数，绝不静默丢弃。
 */

import type { ActivityEntry } from '../types.ts'

export type ScanLevel = 'index' | 'summary' | 'raw'

export interface RenderScanOptions {
  readonly level?: ScanLevel
  /** 总行数上限；缺省按 level 取值（index 60 / summary 160 / raw 120）。 */
  readonly maxLines?: number
  /** 每块最多展开的分组数；缺省按 level 取值（index 10 / summary 6）。 */
  readonly maxGroups?: number
  /** summary 中每条结论的截断字数（默认 400）。 */
  readonly bodyChars?: number
}

/** 下钻过滤：会话 id（前缀包含匹配）与关键词（任一命中）。 */
export interface ScanFilter {
  readonly sessionId?: string
  readonly keywords?: string
}

const DEFAULT_MAX_LINES: Record<ScanLevel, number> = { index: 60, summary: 160, raw: 120 }
const DEFAULT_MAX_GROUPS: Record<ScanLevel, number> = { index: 10, summary: 6, raw: 200 }
const SUMMARY_BODY_CHARS = 400
const QUESTION_CHARS = 200

const day = (ts: number): string => (ts > 0 ? new Date(ts).toISOString().slice(0, 10) : '?')

function spanOf(entries: readonly ActivityEntry[]): string {
  const times = entries.map((e) => e.ts).filter((t) => t > 0)
  if (times.length === 0) return '?'
  const first = day(Math.min(...times))
  const last = day(Math.max(...times))
  return first === last ? first : first + '~' + last
}

interface Group {
  readonly id: string
  readonly title: string
  readonly kind: 'commit' | 'conversation'
  readonly entries: ActivityEntry[]
}

interface Block {
  readonly channel: string
  readonly label: string
  readonly entries: ActivityEntry[]
}

function blocksOf(entries: readonly ActivityEntry[]): Block[] {
  const map = new Map<string, Block>()
  for (const e of entries) {
    const channel = e.channel ?? (e.kind === 'commit' ? 'git' : 'conversation')
    const key = channel + '\u0000' + e.sourceLabel
    const hit = map.get(key)
    if (hit) hit.entries.push(e)
    else map.set(key, { channel, label: e.sourceLabel, entries: [e] })
  }
  return [...map.values()].sort((a, b) => b.entries.length - a.entries.length)
}

/** 按分组键聚合（会话 id / 分支名）；无分组键的条目各自成组。 */
function groupsOf(entries: readonly ActivityEntry[]): Group[] {
  const map = new Map<string, Group>()
  let anon = 0
  for (const e of entries) {
    const id = e.group ?? '#' + String(++anon)
    const hit = map.get(id)
    if (hit) hit.entries.push(e)
    else map.set(id, { id, title: e.group ?? e.title, kind: e.kind, entries: [e] })
  }
  for (const g of map.values()) {
    const named = g.entries.find((e) => e.groupTitle !== undefined)
    if (named?.groupTitle) {
      ;(g as { title: string }).title = named.groupTitle
    }
    // 弱标题兜底：会话标题可能是空壳（'11'）或干脆是会话 id（'agent-abe2c29643c8ed30e'），
    // 这类标题在报告里毫无信息量，改用该组首条用户提问。
    if (isWeakTitle(g.title)) {
      const q = firstUserBody(g)
      if (q) (g as { title: string }).title = q
    }
  }
  return [...map.values()].sort((a, b) => b.entries.length - a.entries.length)
}

function countText(g: Group): string {
  const users = g.entries.filter((e) => e.role === 'user').length
  const assistants = g.entries.filter((e) => e.role === 'assistant').length
  if (g.kind === 'commit') return g.entries.length + ' 提交'
  if (users === 0 && assistants === 0) return g.entries.length + ' 条'
  return g.entries.length + ' 条（问 ' + users + ' / 答 ' + assistants + '）'
}

/** 会话 id 形态（'agent-abe2c29643c8ed30e'、uuid 等）：没有语义，不该出现在报告里。 */
const ID_LIKE = /^(agent|session|sess|run|rollout)?[0-9a-f]{8,}$/i

/** 标题是否"无信息量"：空壳（'11'）或干脆是会话 id。 */
function isWeakTitle(title: string): boolean {
  const s = title.trim()
  if (s.length === 0) return true
  if (s.replace(/[^\w\u4e00-\u9fa5]/g, '').length < 4) return true
  return !/[\u4e00-\u9fa5]/.test(s) && ID_LIKE.test(s.replace(/[\s_-]/g, ''))
}

/** 弱标题兜底：该组最早的一条用户提问（截 40 字）。 */
function firstUserBody(g: Group): string | undefined {
  if (g.kind !== 'conversation') return undefined
  const hit = g.entries.filter((e) => e.role === 'user').sort((a, b) => a.ts - b.ts)[0]
  return hit ? truncate(hit.body, 40) : undefined
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

function firstUser(g: Group): string | undefined {
  const hit = g.entries.filter((e) => e.role === 'user').sort((a, b) => a.ts - b.ts)[0]
  return hit ? truncate(hit.body, QUESTION_CHARS) : undefined
}

function lastAssistant(g: Group): string | undefined {
  const hit = g.entries.filter((e) => e.role === 'assistant').sort((a, b) => b.ts - a.ts)[0]
  return hit ? truncate(hit.body, SUMMARY_BODY_CHARS) : undefined
}

const rawLine = (e: ActivityEntry): string =>
  '- [' + e.kind + '] ' + e.sourceLabel + ' · ' + day(e.ts) + ' · ' + e.title

/** 渲染扫描结果（纯函数，供工具与单测共用）。 */
export function renderScan(entries: readonly ActivityEntry[], options: RenderScanOptions = {}): string {
  const level = options.level ?? 'index'
  if (entries.length === 0) return '(no entries)'
  if (level === 'raw') return renderRaw(entries, options)
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES[level]
  const maxGroups = options.maxGroups ?? DEFAULT_MAX_GROUPS[level]
  const lines: string[] = []
  const folded: string[] = []
  for (const block of blocksOf(entries)) {
    const groups = groupsOf(block.entries)
    const summary = block.entries.reduce(
      (acc, e) => (e.kind === 'commit' ? { commits: acc.commits + 1, messages: acc.messages } : { commits: acc.commits, messages: acc.messages + 1 }),
      { commits: 0, messages: 0 },
    )
    const counts = [summary.commits > 0 ? summary.commits + ' 提交' : '', summary.messages > 0 ? summary.messages + ' 条消息' : ''].filter(Boolean).join(' / ')
    lines.push('[' + block.channel + '] ' + block.label + ' · ' + spanOf(block.entries) + ' · ' + counts + ' · ' + groups.length + ' 组')
    for (const g of groups.slice(0, maxGroups)) {
      if (level === 'summary') {
        lines.push('  ▸ ' + g.title + ' · ' + spanOf(g.entries) + ' · ' + countText(g))
        const q = firstUser(g)
        const a = lastAssistant(g)
        if (q) lines.push('    问：' + q)
        if (a) lines.push('    答：' + a)
      } else {
        lines.push('  · ' + g.title + ' · ' + spanOf(g.entries) + ' · ' + countText(g))
      }
    }
    if (groups.length > maxGroups) {
      const rest = groups.slice(maxGroups)
      folded.push(block.channel + '/' + block.label + ' ' + rest.length + ' 组（' + rest.slice(0, 3).map((g) => g.title).join('、') + (rest.length > 3 ? ' 等' : '') + '）')
    }
  }
  let truncatedLines = 0
  if (lines.length > maxLines) {
    truncatedLines = lines.length - maxLines
    lines.length = maxLines
  }
  const footer: string[] = []
  if (folded.length > 0) footer.push('… 未展开分组：' + folded.join('；'))
  if (truncatedLines > 0) footer.push('… 另有 ' + truncatedLines + ' 行未显示')
  const total = entries.reduce((n, e) => n + 1, 0)
  footer.push('（共 ' + total + ' 条 · ' + blocksOf(entries).reduce((n, b) => n + groupsOf(b.entries).length, 0) + ' 组；下钻：level=summary，或 level=raw + session_id / keywords）')
  return lines.concat(footer).join('\n')
}

function renderRaw(entries: readonly ActivityEntry[], options: RenderScanOptions): string {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES.raw
  const sorted = [...entries].sort((a, b) => a.ts - b.ts)
  const lines = sorted.slice(0, maxLines).map(rawLine)
  if (sorted.length > maxLines) {
    lines.push('… (truncated, ' + (sorted.length - maxLines) + ' more)')
  }
  return lines.join('\n')
}

/** 应用下钻过滤（会话 id 包含匹配；keywords 空格/逗号分隔，任一命中）。 */
export function filterEntries(entries: readonly ActivityEntry[], filter: ScanFilter = {}): ActivityEntry[] {
  const session = filter.sessionId?.trim().toLowerCase()
  const terms = (filter.keywords ?? '')
    .split(/[\s,，]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  return entries.filter((e) => {
    if (session) {
      const key = ((e.group ?? '') + ' ' + (e.groupTitle ?? '')).toLowerCase()
      if (!key.includes(session)) return false
    }
    if (terms.length > 0) {
      const hay = (e.title + ' ' + e.body).toLowerCase()
      if (!terms.some((t) => hay.includes(t))) return false
    }
    return true
  })
}
