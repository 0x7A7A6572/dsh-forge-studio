/**
 * DSH 会话渠道：`<DSH_HOME>/sessions/--<key>--/session-<id>/session[.v3].jsonl[.zstd]`。
 *
 * 三个关键事实（实测）：
 * 1. 会话目录名由 cwd 编码而来，这里**不依赖该编码**——统一用会话头部（首帧）的 `cwd` 字段做归属匹配；
 * 2. 正文是**追加写的多帧 zstd**：`zstdDecompressSync` 只解得出第一帧（头部元数据），必须逐帧解压；
 * 3. 同一会话可能同时存在 v0（session.jsonl.zstd）与 v3（session.v3.jsonl.zstd）两份镜像，优先 v3，否则重复计数。
 *
 * 只采集 `user/message` 与 `assistant/message` 的 text 块：
 * `agent/inbox/spliced` 是 user/message 的副本、`assistant/chunk` 是 assistant/message 的流式副本、
 * reasoning 属模型内部推理，三者都不入正文；`user/message` 还要看 `data.source.kind`——
 * 只有 `user` 是真人输入，plugin / agent-instructions / skill-catalog / system 都是宿主注入的上下文
 * （运行时快照、工作区指令、技能目录等），计入正文会污染报告。
 */

import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import type { ActivityEntry, DateRange } from '../types.ts'
import type { SessionInfo } from './conversation-jsonl.ts'
import { normalizeCwd } from './agent-logs.ts'
import type { ChannelProvider } from './provider.ts'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 同一会话目录的候选文件（按优先级）：v3 为迁移后权威，缺失才回退 v0。 */
const SESSION_FILES = ['session.v3.jsonl.zstd', 'session.v3.jsonl', 'session.jsonl.zstd', 'session.jsonl']

/** 读头部 cwd 的窗口（首帧就是 session 行，8KB 足够）。 */
const HEADER_BYTES = 8192

/** `user/message` 里属于宿主注入（非真人输入）的 source.kind。 */
const INJECTED_USER_SOURCES = new Set(['plugin', 'agent-instructions', 'skill-catalog', 'system'])

/** 会话库根目录（遵循 DSH_HOME，缺省 ~/.dsh）。 */
export function dshStoreRoot(): string {
  const home = process.env.DSH_HOME?.trim()
  return join(home && home !== '' ? home : join(homedir(), '.dsh'), 'sessions')
}

function magicIndexes(buf: Buffer): number[] {
  const out: number[] = []
  let i = buf.indexOf(ZSTD_MAGIC)
  while (i !== -1) {
    out.push(i)
    i = buf.indexOf(ZSTD_MAGIC, i + 1)
  }
  return out
}

/**
 * 逐帧解压（无 zstd 帧时按明文返回）。
 * 压缩数据里偶发出现帧魔数时，单个片段会解压失败——此时向后合并到下一个边界重试，
 * 成功后直接跳到该边界，既不会丢行也不会重复。
 */
export function decodeSessionBuffer(buf: Buffer): string {
  const idx = magicIndexes(buf)
  if (idx.length === 0) return buf.toString('utf8')
  let out = ''
  let i = 0
  while (i < idx.length) {
    let advanced = false
    for (let j = i + 1; j <= idx.length; j++) {
      const end = j < idx.length ? idx[j] : buf.length
      try {
        out += zstdDecompressSync(buf.subarray(idx[i], end)).toString('utf8')
        i = j
        advanced = true
        break
      } catch {
        // 片段不完整：继续向后合并
      }
    }
    if (!advanced) i++
  }
  return out
}

async function readHead(file: string): Promise<Buffer | undefined> {
  let fd
  try {
    fd = await open(file, 'r')
    const buf = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead)
  } catch {
    return undefined
  } finally {
    await fd?.close().catch(() => undefined)
  }
}

/** 只解首帧取 cwd（探活用，避免整文件读）。 */
export async function readSessionCwd(file: string): Promise<string | undefined> {
  const head = await readHead(file)
  if (!head || head.length === 0) return undefined
  const idx = magicIndexes(head)
  let text: string
  try {
    text = idx.length > 0
      ? zstdDecompressSync(head.subarray(idx[0], idx[1] ?? head.length)).toString('utf8')
      : head.toString('utf8')
  } catch {
    return undefined
  }
  const line = text.split('\n').find((l) => l.trim() !== '')
  if (!line) return undefined
  try {
    const obj = JSON.parse(line) as { cwd?: unknown }
    return typeof obj.cwd === 'string' && obj.cwd !== '' ? obj.cwd : undefined
  } catch {
    return undefined
  }
}

/** 候选会话文件（存在即可用）。 */
async function pickSessionFile(dir: string): Promise<string | undefined> {
  for (const name of SESSION_FILES) {
    const full = join(dir, name)
    try {
      if ((await stat(full)).isFile()) return full
    } catch {
      // 试下一个候选
    }
  }
  return undefined
}

async function listSubDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

/** 会话目录所属 cwd：从任一 session 子目录的头部取（同一目录下 cwd 相同）。 */
async function dirCwd(dir: string): Promise<string | undefined> {
  for (const sub of (await listSubDirs(dir)).slice(0, 3)) {
    for (const name of SESSION_FILES) {
      const cwd = await readSessionCwd(join(sub, name))
      if (cwd !== undefined) return cwd
    }
  }
  return undefined
}

/** 项目路径命中的 DSH 会话目录（cwd 大小写/分隔符归一后精确匹配）。 */
export async function resolveDshProjectDirs(path: string): Promise<string[]> {
  const want = normalizeCwd(path)
  if (want === '') return []
  let dirs: string[] = []
  try {
    const entries = await readdir(dshStoreRoot(), { withFileTypes: true })
    dirs = entries.filter((e) => e.isDirectory()).map((e) => join(dshStoreRoot(), e.name))
  } catch {
    return []
  }
  const out: string[] = []
  for (const dir of dirs) {
    const cwd = await dirCwd(dir)
    if (cwd !== undefined && normalizeCwd(cwd) === want) out.push(dir)
  }
  return out
}

/** 只取可见正文块（丢弃 reasoning / tool-call / tool-result 等）。 */
function visibleText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => {
      if (b === null || typeof b !== 'object') return ''
      const o = b as { type?: unknown; text?: unknown }
      return o.type === 'text' && typeof o.text === 'string' ? o.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractTs(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (typeof raw === 'string') {
    const n = Date.parse(raw)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** 会话标题（session/title 事件，同一会话可能多次写入，取最后一条）。 */
export function extractSessionTitle(text: string): string | undefined {
  let title: string | undefined
  for (const line of text.split('\n')) {
    if (!line.includes('"session/title"')) continue
    try {
      const o = JSON.parse(line) as { type?: unknown; data?: { title?: unknown } }
      const t = o.data?.title
      if (o.type === 'session/title' && typeof t === 'string' && t.trim()) title = t.trim()
    } catch {
      // 坏行忽略：标题缺失不影响正文采集
    }
  }
  return title
}

/** 把一条 DSH 会话行解析为活动条目（非正文行 / 无正文 / 窗口外 返回 undefined）。 */
export function parseDshSessionLine(
  line: string,
  range: DateRange,
  sourceLabel: string,
  session?: SessionInfo,
): ActivityEntry | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return undefined
  }
  const type = obj.type
  const data = (obj.data ?? {}) as Record<string, unknown>
  let role: 'user' | 'assistant'
  let content: unknown
  if (type === 'user/message') {
    const kind = ((data.source ?? {}) as Record<string, unknown>).kind
    if (typeof kind === 'string' && INJECTED_USER_SOURCES.has(kind)) return undefined
    role = 'user'
    content = data.content
  } else if (type === 'assistant/message') {
    const message = (data.message ?? {}) as Record<string, unknown>
    role = 'assistant'
    content = message.content
  } else {
    return undefined
  }
  const text = visibleText(content).trim()
  if (!text) return undefined
  const ts = extractTs(obj.time)
  if (ts <= 0) return undefined
  const since = Date.parse(range.since) || 0
  const until = range.until ? Date.parse(range.until) : undefined
  if (ts < since) return undefined
  if (until !== undefined && ts > until) return undefined
  const head = text.replace(/\s+/g, ' ').slice(0, 80)
  return {
    ts,
    sourceLabel,
    kind: 'conversation',
    title: `${role === 'user' ? '[提问]' : '[回答]'} ${head}`,
    body: text,
    role,
    ...(session
      ? { group: session.id, ...(session.title ? { groupTitle: session.title } : {}) }
      : {}),
  }
}

export const dshChannel: ChannelProvider = {
  kind: 'dsh',
  async probe(path): Promise<boolean> {
    return (await resolveDshProjectDirs(path)).length > 0
  },
  async scan({ path, label, range }): Promise<ActivityEntry[]> {
    const entries: ActivityEntry[] = []
    for (const dir of await resolveDshProjectDirs(path)) {
      for (const sub of await listSubDirs(dir)) {
        const file = await pickSessionFile(sub)
        if (!file) continue
        let text: string
        try {
          text = decodeSessionBuffer(await readFile(file))
        } catch {
          continue
        }
        const id = basename(sub)
        const title = extractSessionTitle(text)
        const session = title ? { id, title } : { id }
        for (const line of text.split('\n')) {
          const e = parseDshSessionLine(line, range, label, session)
          if (e) entries.push(e)
        }
      }
    }
    return entries.sort((a, b) => a.ts - b.ts)
  },
}
