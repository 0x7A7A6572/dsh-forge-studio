/**
 * Codex 会话渠道：`~/.codex/sessions/<YYYY>/<MM>/<DD>/*.jsonl`。
 * 归属规则：会话文件首行 session_meta 的 payload.cwd == 项目路径（大小写不敏感
 * 归一化对比）；扫描按时间窗裁剪日期目录（YYYY/MM/DD 三段）以减少遍历。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import type { ActivityEntry, DateRange } from '../types.ts'
import { parseConversationLine } from './conversation-jsonl.ts'
import { fileCwd, normalizeCwd } from './agent-logs.ts'
import type { ChannelProvider } from './provider.ts'

/** 生成时间窗内的日期目录路径（since/until 支持 YYYY-MM-DD；其它格式回退全库）。 */
async function listCandidates(root: string, range: DateRange): Promise<string[]> {
  const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/
  const since = dayPattern.exec(range.since)?.[0]
  if (!since) return [root] // 非标准日期（Monday 等）→ 全库遍历
  const until = range.until && dayPattern.exec(range.until) ? range.until : since
  const out: string[] = []
  const [sy, sm, sd] = since.split('-').map(Number)
  const [uy, um, ud] = until.split('-').map(Number)
  try {
    const years = await readdir(root)
    for (const y of years) {
      const yNum = Number(y)
      if (!Number.isInteger(yNum) || yNum < sy || yNum > uy) continue
      const ym = join(root, y)
      const months = await readdir(ym)
      for (const m of months) {
        const mNum = Number(m)
        if (!Number.isInteger(mNum)) continue
        if ((yNum === sy && mNum < sm) || (yNum === uy && mNum > um)) continue
        const ymd = join(ym, m)
        const days = await readdir(ymd)
        for (const d of days) {
          const dNum = Number(d)
          if (!Number.isInteger(dNum)) continue
          if ((yNum === sy && mNum === sm && dNum < sd) || (yNum === uy && mNum === um && dNum > ud)) continue
          out.push(join(ymd, d))
        }
      }
    }
  } catch {
    // 目录不存在 → 空
  }
  return out
}

async function listJsonlFilesIn(dirs: string[]): Promise<string[]> {
  const out: string[] = []
  for (const dir of dirs) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push(join(dir, e.name))
    }
  }
  return out
}

export const codexChannel: ChannelProvider = {
  kind: 'codex',
  async probe(path): Promise<boolean> {
    // 只看最近 90 天是否有该项目会话（文件级 cwd 匹配，命中即停）。
    const root = join(homedir(), '.codex', 'sessions')
    try {
      if (!(await stat(root)).isDirectory()) return false
    } catch {
      return false
    }
    const today = new Date()
    const past = new Date(today.getTime() - 90 * 86400000)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const dirs = await listCandidates(root, { since: iso(past), until: iso(today) })
    const files = await listJsonlFilesIn(dirs)
    const want = normalizeCwd(path)
    for (let i = 0; i < Math.min(files.length, 400); i++) {
      const cwd = await fileCwd(files[i]!)
      if (cwd !== undefined && normalizeCwd(cwd) === want) return true
    }
    return false
  },
  async scan({ path, label, range }): Promise<ActivityEntry[]> {
    const root = join(homedir(), '.codex', 'sessions')
    const dirs = await listCandidates(root, range)
    const files = await listJsonlFilesIn(dirs)
    const want = normalizeCwd(path)
    const entries: ActivityEntry[] = []
    for (const f of files) {
      const cwd = await fileCwd(f)
      if (cwd === undefined || normalizeCwd(cwd) !== want) continue
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
