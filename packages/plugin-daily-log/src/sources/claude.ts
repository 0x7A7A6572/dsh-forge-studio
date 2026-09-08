/**
 * Claude Code 会话渠道：`~/.claude/projects/<slug>` 即某项目的会话目录，
 * slug = 项目路径逐字符编码（每个非 [A-Za-z0-9] 字符 → '-',不压缩）。
 * 命中探测 = 该 slug 目录存在（精确 + 大小写不敏感兜底）。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import type { ActivityEntry } from '../types.ts'
import { parseConversationLine } from './conversation-jsonl.ts'
import type { ChannelProvider } from './provider.ts'

/** 项目路径 → claude 会话目录名（与 Claude Code 的 slugify 规则一致）。 */
export function encodeClaudeSlug(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string, depth: number): Promise<void> {
    if (depth > 4) return
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.name.endsWith('.jsonl')) out.push(full)
    }
  }
  await walk(dir, 0)
  return out
}

/** 解析项目路径对应的会话目录（无则 undefined）。 */
async function resolveProjectDir(path: string): Promise<string | undefined> {
  const root = join(homedir(), '.claude', 'projects')
  const exact = join(root, encodeClaudeSlug(path))
  try {
    if ((await stat(exact)).isDirectory()) return exact
  } catch {
    // fallthrough：尝试大小写不敏感匹配
  }
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return undefined
  }
  const want = encodeClaudeSlug(path).toLowerCase()
  const hit = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === want)
  return hit ? join(root, hit.name) : undefined
}

export const claudeChannel: ChannelProvider = {
  kind: 'claude',
  async probe(path): Promise<boolean> {
    return (await resolveProjectDir(path)) !== undefined
  },
  async scan({ path, label, range }): Promise<ActivityEntry[]> {
    const dir = await resolveProjectDir(path)
    if (!dir) return []
    const entries: ActivityEntry[] = []
    for (const f of await listJsonlFiles(dir)) {
      let text: string
      try {
        text = await readFile(f, 'utf8')
      } catch {
        continue
      }
      for (const line of text.split('\n')) {
        const e = parseConversationLine(line, range, label)
        if (e) entries.push(e)
      }
    }
    return entries
  },
}
