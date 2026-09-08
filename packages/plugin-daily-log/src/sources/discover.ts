/**
 * 会话库项目发现：读取 Claude Code / Codex 的**项目注册表**，归集出「项目路径」清单，
 * 供一键导入穿梭框使用。
 *
 * 只信任两个官方注册表，不做任何会话级兜底推断：
 * - claude：`~/.claude.json` 顶层 `projects`（键 = 项目路径）。
 *   会话数展示由 `~/.claude/history.jsonl`（每行 project + sessionId）按注册表命中路径补充。
 * - codex：`~/.codex/.codex-global-state.json` 的 `local-projects`
 *   （桌面版注册表：name + rootPaths）。
 *
 * 注册表里不存在的路径（如系统临时目录、主目录等）一律不出现 ——
 * 即便某些会话曾在那些目录运行过。
 */

import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { normalizeCwd } from './agent-logs.ts'

export interface DiscoveredSessionProject {
  /** 项目路径（原始文本，首个出现者）。 */
  path: string
  /** 命中会话数（history 去重补充；无法获知时为 0）。 */
  sessionCount: number
  claude: boolean
  codex: boolean
}

/** 会话库索引文件路径覆盖（测试/自定义用）。缺省 = homedir 默认。 */
export interface SessionRoots {
  /** ~/.claude.json（注册表：顶层 projects 键 = 项目路径）。 */
  claudeJson?: string
  /** ~/.claude/history.jsonl（仅用于会话数补充，非项目来源）。 */
  claudeHistory?: string
  /** ~/.codex/.codex-global-state.json（注册表：local-projects）。 */
  codexGlobalState?: string
}

const DEFAULT_ROOTS = (): Required<SessionRoots> => ({
  claudeJson: join(homedir(), '.claude.json'),
  claudeHistory: join(homedir(), '.claude', 'history.jsonl'),
  codexGlobalState: join(homedir(), '.codex', '.codex-global-state.json'),
})

/* ---------- 索引解析（纯函数，可单测） ---------- */

interface IndexedProject {
  path: string
  sessionCount: number
}

/**
 * 解析 claude ~/.claude.json 文本 → 顶层 `projects` 对象（注册表）的键 = 项目路径。
 * 例如键形如 "C:/Users/hake-/CODE/hake_app_2.0"（桌面版以 / 分隔、盘符大写）。
 */
export function claudeProjectsFromStateJson(text: string): string[] {
  let state: { projects?: unknown }
  try {
    state = JSON.parse(text) as { projects?: unknown }
  } catch {
    return []
  }
  const projects = state.projects
  if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) return []
  return Object.keys(projects as Record<string, unknown>).filter((k) => k !== '')
}

/** 解析 claude history.jsonl 文本 → 按 project 聚合（sessionId 去重计数）。 */
export function claudeProjectsFromHistory(text: string): IndexedProject[] {
  const byKey = new Map<string, { raw: string; sessions: Set<string> }>()
  for (const line of text.split('\n')) {
    if (!line.includes('"project"')) continue
    let row: { project?: unknown; sessionId?: unknown }
    try {
      row = JSON.parse(line) as { project?: unknown; sessionId?: unknown }
    } catch {
      continue
    }
    if (typeof row.project !== 'string' || row.project === '') continue
    const key = normalizeCwd(row.project)
    const cur = byKey.get(key)
    if (cur) {
      if (typeof row.sessionId === 'string') cur.sessions.add(row.sessionId)
    } else {
      byKey.set(key, { raw: row.project, sessions: typeof row.sessionId === 'string' ? new Set([row.sessionId]) : new Set() })
    }
  }
  return Array.from(byKey.values(), ({ raw, sessions }) => ({ path: raw, sessionCount: sessions.size }))
}

/** 解析 codex .codex-global-state.json 文本 → local-projects 的项目路径。 */
export function codexProjectsFromGlobalState(text: string): IndexedProject[] {
  const out: IndexedProject[] = []
  let state: { 'local-projects'?: unknown }
  try {
    state = JSON.parse(text) as { 'local-projects'?: unknown }
  } catch {
    return out
  }
  const projects = state['local-projects']
  if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) return out
  for (const p of Object.values(projects as Record<string, unknown>)) {
    const rec = p as { name?: unknown; rootPaths?: unknown } | null
    if (!rec || typeof rec !== 'object') continue
    const paths = Array.isArray(rec.rootPaths)
      ? rec.rootPaths.filter((x): x is string => typeof x === 'string' && x !== '')
      : []
    for (const rp of paths) out.push({ path: rp, sessionCount: 0 })
  }
  return out
}

/* ---------- 非项目路径过滤 ---------- */

const HOME_KEY = normalizeCwd(homedir())
const TRANSIENT_PREFIXES = [normalizeCwd(tmpdir()), '/tmp', '/private/tmp', '/var/folders']

/**
 * 判定归一化路径是否属「非项目」路径：
 * 系统临时目录（%TEMP%、/tmp、/var/folders 等，如 modlens-work-XXX）、主目录本身。
 */
export function isTransientPath(rawPath: string): boolean {
  const key = normalizeCwd(rawPath)
  if (key === '' || key === HOME_KEY) return true
  return TRANSIENT_PREFIXES.some((t) => key === t || key.startsWith(t + '/'))
}

/**
 * 读取两个官方注册表，返回按归一化路径聚合的项目发现结果。
 * 注册表缺失/为空 → 对应渠道无项目（不做兜底推断）。
 * @param roots 索引文件路径覆盖（默认 homedir；传空串 '' 禁用对应源）。
 * @param useIndexes false = 全部禁用（测试隔离用）。
 */
export async function discoverSessionProjects(
  roots?: SessionRoots,
  useIndexes = true,
): Promise<DiscoveredSessionProject[]> {
  const def = DEFAULT_ROOTS()
  const r: Required<SessionRoots> = {
    claudeJson: roots?.claudeJson ?? def.claudeJson,
    claudeHistory: roots?.claudeHistory ?? def.claudeHistory,
    codexGlobalState: roots?.codexGlobalState ?? def.codexGlobalState,
  }
  const byKey = new Map<string, DiscoveredSessionProject>()
  const addProject = (raw: string, channel: 'claude' | 'codex', sessionCount: number): void => {
    const key = normalizeCwd(raw)
    if (key === '' || isTransientPath(raw)) return
    const cur = byKey.get(key)
    if (cur) {
      cur.sessionCount += sessionCount
      if (channel === 'claude') cur.claude = true
      else cur.codex = true
    } else {
      byKey.set(key, {
        path: raw.trim(),
        sessionCount,
        claude: channel === 'claude',
        codex: channel === 'codex',
      })
    }
  }

  if (useIndexes) {
    // Claude 注册表（权威项目集）；history 只为命中路径补会话数。
    if (r.claudeJson !== '') {
      const registryKeys = await readFile(r.claudeJson, 'utf8').then(
        (text) => claudeProjectsFromStateJson(text),
        () => null,
      )
      if (registryKeys !== null && registryKeys.length > 0) {
        let countBy = new Map<string, number>()
        if (r.claudeHistory !== '') {
          const hist = await readFile(r.claudeHistory, 'utf8').then(
            (text) => claudeProjectsFromHistory(text),
            () => null,
          )
          countBy = new Map((hist ?? []).map((p) => [normalizeCwd(p.path), p.sessionCount]))
        }
        for (const key of registryKeys) addProject(key, 'claude', countBy.get(normalizeCwd(key)) ?? 0)
      }
    }

    // Codex 注册表（权威项目集）。
    if (r.codexGlobalState !== '') {
      const indexed = await readFile(r.codexGlobalState, 'utf8').then(
        (text) => codexProjectsFromGlobalState(text),
        () => null,
      )
      if (indexed !== null) {
        for (const p of indexed) addProject(p.path, 'codex', p.sessionCount)
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.path.localeCompare(b.path))
}
