import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claudeProjectsFromHistory,
  claudeProjectsFromStateJson,
  codexProjectsFromGlobalState,
  discoverSessionProjects,
} from '../src/sources/discover.ts'

async function makeBase(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dlog-disc-'))
}

describe('集中索引解析（纯函数）', () => {
  it('claude history.jsonl：按 project 聚合、sessionId 去重计数', () => {
    const text = [
      JSON.stringify({ display: '/init', timestamp: 1, project: 'C:\\WORK\\myapp', sessionId: 's1' }),
      JSON.stringify({ display: 'hi', timestamp: 2, project: 'C:\\WORK\\myapp', sessionId: 's1' }), // 同会话第二条
      JSON.stringify({ display: 'yo', timestamp: 3, project: 'c:\\work\\myapp', sessionId: 's2' }), // 大小写不同仍同项目
      JSON.stringify({ display: 'x', timestamp: 4, project: 'D:\\code\\other', sessionId: 's9' }),
      JSON.stringify({ display: 'bad' }), // 无 project 忽略
    ].join('\n')
    const found = claudeProjectsFromHistory(text)
    expect(found).toHaveLength(2)
    const myapp = found.find((p) => p.path.toLowerCase().includes('myapp'))
    expect(myapp?.path).toBe('C:\\WORK\\myapp') // 保留首个原始文本
    expect(myapp?.sessionCount).toBe(2) // s1 + s2 去重
    expect(found.find((p) => p.path.includes('other'))?.sessionCount).toBe(1)
  })

  it('codex .codex-global-state.json：local-projects → rootPaths', () => {
    const text = JSON.stringify({
      'local-projects': {
        a: { id: 'a', name: 'hake_app_2.0', rootPaths: ['c:\\Users\\hake-\\CODE\\hake_app_2.0'] },
        b: { id: 'b', name: 'novelcraft', rootPaths: ['d:\\codes\\novelcraft'] },
        c: { id: 'c', name: 'multi', rootPaths: ['x:\\a', 'x:\\b'] },
      },
    })
    const found = codexProjectsFromGlobalState(text)
    expect(found.map((p) => p.path)).toEqual(['c:\\Users\\hake-\\CODE\\hake_app_2.0', 'd:\\codes\\novelcraft', 'x:\\a', 'x:\\b'])
    expect(found.every((p) => p.sessionCount === 0)).toBe(true)
  })

  it('codex 全局状态无 local-projects 或非法 JSON → 空', () => {
    expect(codexProjectsFromGlobalState('{"foo":1}')).toEqual([])
    expect(codexProjectsFromGlobalState('not json')).toEqual([])
  })

  it('claude .claude.json：顶层 projects 对象键 = 项目路径', () => {
    const text = JSON.stringify({
      numStartups: 3,
      projects: {
        'C:/Users/hake-/CODE/hake_app_2.0': { allowedTools: [] },
        'D:/codes/blog': { allowedTools: [] },
      },
      model: 'claude',
    })
    expect(claudeProjectsFromStateJson(text)).toEqual([
      'C:/Users/hake-/CODE/hake_app_2.0',
      'D:/codes/blog',
    ])
    expect(claudeProjectsFromStateJson('{"projects":{}}')).toEqual([])
    expect(claudeProjectsFromStateJson('not json')).toEqual([])
    expect(claudeProjectsFromStateJson('{"foo":1}')).toEqual([])
  })
})

describe('discoverSessionProjects：集中索引优先', () => {
  it('claude.json 注册表（权威项目集）+ history 补会话数 + codex 注册表 → 合并', async () => {
    const base = await makeBase()
    try {
      const claudeJson = join(base, 'claude.json')
      const history = join(base, 'history.jsonl')
      const globalState = join(base, 'global.json')
      // 注册表：键即项目路径（桌面版 / 分隔大写盘符；与 codex 同路径但书写不同）。
      await writeFile(
        claudeJson,
        JSON.stringify({
          projects: {
            'C:/WORK/both': { allowedTools: [] },
            'D:/claude-only': { allowedTools: [] },
          },
        }),
        'utf8',
      )
      // history：只提供会话数（注册表已有项目；此处 both 两条同项目异会话）。
      await writeFile(
        history,
        [
          JSON.stringify({ display: 'a', project: 'C:/WORK/both', sessionId: 's1' }),
          JSON.stringify({ display: 'a2', project: 'C:\\WORK\\both', sessionId: 's2' }),
          JSON.stringify({ display: 'b', project: 'D:\\claude-only', sessionId: 's3' }),
        ].join('\n'),
        'utf8',
      )
      await writeFile(
        globalState,
        JSON.stringify({
          'local-projects': {
            x: { name: 'both', rootPaths: ['c:\\work\\both'] }, // 与 claude 同项目
            y: { name: 'codex-only', rootPaths: ['E:\\codex-only'] },
          },
        }),
        'utf8',
      )
      const found = await discoverSessionProjects({
        claudeJson,
        claudeHistory: history,
        codexGlobalState: globalState,
      })
      expect(found).toHaveLength(3)
      const both = found.find((f) => f.path.toLowerCase().includes('both'))
      expect(both?.path).toBe('C:/WORK/both') // 保留注册表原始文本
      expect(both?.claude).toBe(true)
      expect(both?.codex).toBe(true)
      expect(both?.sessionCount).toBe(2) // history 补 2 个会话 + codex 0
      expect(found.find((f) => f.path.includes('claude-only'))?.claude).toBe(true)
      expect(found.find((f) => f.path.includes('claude-only'))?.sessionCount).toBe(1)
      expect(found.find((f) => f.path.includes('codex-only'))?.codex).toBe(true)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('claude 注册表缺失/为空 → claude 无项目（不把 history 当项目源），codex 照常', async () => {
    const base = await makeBase()
    try {
      const history = join(base, 'history.jsonl') // 有大量 history，但绝不能成为项目来源
      const globalState = join(base, 'global.json')
      await writeFile(
        history,
        [
          JSON.stringify({ display: 'a', project: 'C:\\WORK\\both', sessionId: 's1' }),
          JSON.stringify({ display: 'b', project: 'D:\\claude-only', sessionId: 's2' }),
        ].join('\n'),
        'utf8',
      )
      await writeFile(
        globalState,
        JSON.stringify({
          'local-projects': {
            x: { name: 'both', rootPaths: ['c:\\work\\both'] },
            y: { name: 'codex-only', rootPaths: ['E:\\codex-only'] },
          },
        }),
        'utf8',
      )
      const found = await discoverSessionProjects({
        claudeJson: '', // 注册表缺失（测试隔离，避免读到真实 ~/.claude.json）
        claudeHistory: history, // history 存在也不作项目源
        codexGlobalState: globalState,
      })
      // 只有 codex 注册表两个项目；claude-only 不出现，both 仅为 codex。
      expect(found).toHaveLength(2)
      const both = found.find((f) => f.path.toLowerCase().includes('both'))
      expect(both?.claude).toBe(false)
      expect(both?.codex).toBe(true)
      expect(found.some((f) => f.path.includes('claude-only'))).toBe(false)
      expect(found.find((f) => f.path.includes('codex-only'))?.codex).toBe(true)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('注册表中的临时目录/主目录路径被过滤，正常项目保留', async () => {
    const base = await makeBase()
    try {
      const claudeJson = join(base, 'claude.json')
      const { tmpdir, homedir } = await import('node:os')
      const modlensTemp = join(tmpdir(), 'modlens-work-XjxS20') // 用户报的那类路径
      await writeFile(
        claudeJson,
        JSON.stringify({
          projects: {
            [modlensTemp]: {},
            [homedir()]: {}, // 主目录本身
            'C:\\WORK\\myapp': {},
          },
        }),
        'utf8',
      )
      const found = await discoverSessionProjects({
        claudeJson,
        claudeHistory: '', // 无需会话数
        codexGlobalState: '', // 禁用（避免污染本机真实注册表）
      })
      expect(found).toHaveLength(1)
      expect(found[0]?.path).toBe('C:\\WORK\\myapp')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('所有索引禁用 → 空结果（不抛错）', async () => {
    const base = await makeBase()
    try {
      const found = await discoverSessionProjects(
        { claudeJson: '', claudeHistory: '', codexGlobalState: '' },
        false,
      )
      expect(found).toEqual([])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
