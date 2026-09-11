/**
 * Git 数据源 provider：`git log --all` 白名单执行（execFile 数组传参防注入），
 * 解析为结构化活动条目（commit）。沿用 safeGitExecute 白名单语义。
 *
 * 作者过滤：默认只取"本人提交"——未显式传 author 时回落到该仓库的
 * `git config user.email`；显式传 `*` 或 `all` 表示放开全作者。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ActivityEntry } from '../types.ts'
import type { ChannelProvider } from './provider.ts'

const execFileAsync = promisify(execFile)

/** 最多返回的 commit 条数（超出截断）。 */
const MAX_COMMITS = 500
const LOG_FORMAT = '%H|%an|%ai|%s|%D'

async function gitLog(projectPath: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', projectPath, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    })
    if (stderr && !stdout) return stderr
    return stdout
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`git 扫描失败（${projectPath}）：${msg}`)
  }
}

/** 显式放开作者过滤的取值：项目级 author 填 `*` 或 `all` 时不加 `--author`。 */
const ALL_AUTHOR_VALUES = new Set(['*', 'all'])

/** 读取 git 生效的提交身份邮箱（`git config user.email`：仓库 local 优先、回落全局）；未配置或不可用时为空串。 */
export async function readRepoUserEmail(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'config', 'user.email'], {
      maxBuffer: 64 * 1024,
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

/**
 * 解析实际生效的作者过滤值：显式传入优先（`*`/`all` → 不过滤），
 * 未传入时回落到仓库自身的 user.email —— 即默认"仅本人提交"；都无法确定时不过滤。
 */
export async function resolveAuthorFilter(projectPath: string, author?: string): Promise<string> {
  const explicit = (author ?? '').trim()
  if (ALL_AUTHOR_VALUES.has(explicit.toLowerCase())) return ''
  if (explicit) return explicit
  return readRepoUserEmail(projectPath)
}

function parseGitLog(raw: string): Array<{ hash: string; author: string; date: string; message: string; branch: string }> {
  const trimmed = raw.trim()
  if (!trimmed) return []
  return trimmed.split('\n').map((line) => {
    const parts = line.split('|', 5)
    return {
      hash: (parts[0] ?? '').trim(),
      author: (parts[1] ?? '').trim(),
      date: (parts[2] ?? '').trim(),
      message: (parts[3] ?? '').trim(),
      branch: (parts[4] ?? '').trim(),
    }
  })
}

export const gitChannel: ChannelProvider = {
  kind: 'git',
  async probe(path): Promise<boolean> {
    try {
      await stat(join(path, '.git'))
      return true
    } catch {
      return false
    }
  },
  async scan({ path, label, range, author }): Promise<ActivityEntry[]> {
    const authorFilter = await resolveAuthorFilter(path, author)
    const args = [
      'log', '--all', `--format=${LOG_FORMAT}`,
      `--since=${range.since}`, `--max-count=${MAX_COMMITS + 1}`,
    ]
    if (range.until) args.push(`--until=${range.until}`)
    if (authorFilter) args.push(`--author=${authorFilter}`)
    const out = await gitLog(path, args)
    return parseGitLog(out).slice(0, MAX_COMMITS).map((c) => ({
      ts: Date.parse(c.date) || 0,
      sourceLabel: label,
      kind: 'commit',
      title: c.message || '(no message)',
      body: `${c.hash} · ${c.date}${c.branch ? ` · ${c.branch}` : ''}`,
    }))
  },
}
