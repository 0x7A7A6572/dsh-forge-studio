import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { DailyLogService } from '../src/service.ts'
import type { DailyLogServiceConfig } from '../src/service.ts'
import type { ActivityEntry, SourceId, SourceKind, TemplateId } from '../src/types.ts'
import type { ReportRecord, SourceRecord, TemplateRecord } from '../src/types.ts'
import type { ChannelProvider } from '../src/sources/provider.ts'
import { encodeClaudeSlug } from '../src/sources/claude.ts'
import { gitChannel } from '../src/sources/git.ts'

function fakeTable<V>(): KvTable<string, V> {
  const map = new Map<string, V>()
  return {
    get: (k) => map.get(k),
    entries: () => map.entries() as IterableIterator<[string, V]>,
    keys: () => map.keys() as IterableIterator<string>,
    get size() { return map.size },
    put: async (k, v) => { map.set(k, v) },
    delete: async (k) => map.delete(k),
    update: async (k, fn) => {
      const cur = map.get(k)
      if (!cur) throw new Error('missing-key')
      const next = fn(cur)
      map.set(k, next)
      return next
    },
  }
}

function makeService(overrides: Partial<Omit<DailyLogServiceConfig, 'domain'>> = {}): {
  svc: DailyLogService
  sources: KvTable<string, SourceRecord>
  reports: KvTable<string, ReportRecord>
  templates: KvTable<string, TemplateRecord>
} {
  const ctx = new Context()
  const sources = fakeTable<SourceRecord>()
  const reports = fakeTable<ReportRecord>()
  const templates = fakeTable<TemplateRecord>()
  const domain = {
    table: (name: string) => (name === 'sources' ? sources : name === 'reports' ? reports : name === 'templates' ? templates : undefined),
  } as never
  const svc = new DailyLogService(ctx, { domain, ...overrides })
  return { svc, sources, reports, templates }
}

/** 假渠道：probe 恒 probeRes；命中时 scan 返回固定条目。 */
function mkChannel(kind: SourceKind, probeRes: boolean, entries: ActivityEntry[] = []): ChannelProvider {
  return {
    kind,
    probe: async () => probeRes,
    scan: async () => entries,
  }
}

const entry = (kind: SourceKind, title: string): ActivityEntry => ({
  ts: Date.parse('2026-07-01T00:00:00Z'),
  sourceLabel: title,
  kind: 'conversation',
  title,
  body: '',
})

/** 建临时目录；withGit 时内部 mkdir .git（探测 type=code 用）。 */
async function makeTempDir(withGit: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dlog-test-'))
  if (withGit) await mkdir(join(dir, '.git'))
  return dir
}

function legacyRecord(id: string, kind: string, path: string, type = 'other'): SourceRecord & { kind: string } {
  const now = Date.now()
  return {
    id: id as SourceId,
    kind,
    type: type as 'code' | 'other',
    label: id,
    path,
    createdAt: now,
    updatedAt: now,
  }
}

describe('DailyLogService 项目（数据源）', () => {
  it('addSource 持久化 + 默认 label 取路径 basename', async () => {
    const { svc, sources } = makeService()
    const s = await svc.addSource({ path: 'C:/repo/myapp' })
    expect(s.label).toBe('myapp')
    expect(sources.get(s.id)?.path).toBe('C:/repo/myapp')
  })

  it('listSources / removeSource', async () => {
    const { svc } = makeService()
    const s = await svc.addSource({ path: '/a' })
    expect((await svc.listSources()).length).toBe(1)
    expect(await svc.removeSource(s.id)).toBe(true)
    expect(await svc.listSources()).toEqual([])
    expect(await svc.removeSource(s.id)).toBe(false)
  })

  it('addSource 带 label 优先用 label', async () => {
    const { svc } = makeService()
    const s = await svc.addSource({ path: 'C:/x', label: '我的项目' })
    expect(s.label).toBe('我的项目')
  })

  it('同路径重复添加被拒绝（项目路径唯一）', async () => {
    const { svc } = makeService()
    await svc.addSource({ path: 'C:/repo/x' })
    await expect(svc.addSource({ path: 'c:/repo/x/' })).rejects.toThrow(/已在数据源中/)
  })
})

describe('DailyLogService 旧记录迁移', () => {
  it('kind=git → 转项目（去 kind）；claude/codex/dsh 会话目录旧源 → 丢弃', async () => {
    const repo = await makeTempDir(true)
    try {
      const { svc, sources } = makeService()
      const git = legacyRecord('g1', 'git', repo, 'code')
      const claude = legacyRecord('c1', 'claude', join(tmpdir(), '.claude', 'projects', 'x'))
      const codex = legacyRecord('x1', 'codex', join(tmpdir(), '.codex', 'sessions'))
      await sources.put(git.id, git)
      await sources.put(claude.id, claude)
      await sources.put(codex.id, codex)
      // 任意触发迁移的调用（listSources 内部 ensureMigrated；避免与旧记录同路径冲突）。
      await svc.listSources()
      const list = await svc.listSources()
      // 迁移后：git 旧源保留（转项目、去 kind）；两个会话目录旧源丢弃。
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ path: repo, type: 'code', label: 'g1' })
      expect('kind' in (list[0] as object)).toBe(false)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('无旧记录时迁移幂等（无副作用）', async () => {
    const { svc } = makeService()
    await svc.addSource({ path: '/a' })
    expect((await svc.listSources()).length).toBe(1)
  })
})

describe('DailyLogService 报告', () => {
  it('createReport / listReports / getReport / deleteReport', async () => {
    const { svc } = makeService()
    const r = await svc.createReport({ title: '周报', markdown: '# hi', sourceIds: [], dateRange: { since: '2026-06-30' } })
    expect(svc.listReports().length).toBe(1)
    expect(svc.getReport(r.id)?.title).toBe('周报')
    expect(await svc.deleteReport(r.id)).toBe(true)
    expect(svc.listReports()).toEqual([])
  })
})

describe('DailyLogService 模板', () => {
  it('构造后内置 default 模板存在且为默认', () => {
    const { svc } = makeService()
    const list = svc.listTemplates()
    expect(list.length).toBe(1)
    expect(list[0]).toMatchObject({ name: 'default', isBuiltin: true, isDefault: true })
  })

  it('createTemplate / updateTemplate / deleteTemplate', async () => {
    const { svc } = makeService()
    const t = await svc.createTemplate({ name: 'daily', content: '# x' })
    expect(t.isBuiltin).toBe(false)
    expect(t.isDefault).toBe(false)
    const u = await svc.updateTemplate(t.id, { content: '# y' })
    expect(u?.content).toBe('# y')
    expect(await svc.deleteTemplate(t.id)).toBe(true)
    expect(svc.listTemplates().length).toBe(1)
  })

  it('内置模板不可删除/更新', async () => {
    const { svc } = makeService()
    const builtin = svc.listTemplates().find((t) => t.isBuiltin)!
    await expect(svc.deleteTemplate(builtin.id)).rejects.toThrow(/内置模板不可删除/)
    await expect(svc.updateTemplate(builtin.id, { content: 'x' })).rejects.toThrow(/内置模板不可更新/)
  })

  it('重名模板被拒绝', async () => {
    const { svc } = makeService()
    await svc.createTemplate({ name: 'daily', content: 'x' })
    await expect(svc.createTemplate({ name: 'daily', content: 'y' })).rejects.toThrow(/已存在/)
  })

  it('setDefaultTemplate 切换默认', async () => {
    const { svc } = makeService()
    const t = await svc.createTemplate({ name: 'weekly', content: 'w' })
    expect(await svc.setDefaultTemplate(t.id)).toBe(true)
    const list = svc.listTemplates()
    expect(list.find((x) => x.id === t.id)?.isDefault).toBe(true)
    expect(list.find((x) => x.isBuiltin)?.isDefault).toBe(false)
  })
})

describe('DailyLogService 扫描（按项目聚合渠道）', () => {
  it('命中的多渠道条目全部聚合；未命中渠道不产出', async () => {
    const { svc } = makeService({
      channels: [
        mkChannel('git', true, [entry('git', 'commit-a')]),
        mkChannel('claude', true, [entry('claude', 'c1'), entry('claude', 'c2')]),
        mkChannel('codex', false, [entry('codex', 'should-not')]),
      ],
    })
    const s = await svc.addSource({ path: '/a', label: 'proj' })
    const res = await svc.scanSource(s.id, { since: '2026-06-30' })
    expect(res.entries).toHaveLength(3)
    expect(res.truncated).toBe(false)
    // 归属统一为项目 label（同路径多源合并）。
    expect(res.entries.every((e) => e.sourceLabel === 'proj')).toBe(true)
  })

  it('渠道 probe/scan 异常不中断整体，错误汇入 truncatedHint', async () => {
    const { svc } = makeService({
      channels: [
        {
          kind: 'git',
          probe: async () => true,
          scan: async () => { throw new Error('git scan boom') },
        },
        {
          kind: 'claude',
          probe: async () => { throw new Error('claude probe boom') },
          scan: async () => [entry('claude', 'x')],
        },
      ],
    })
    const s = await svc.addSource({ path: '/a' })
    const res = await svc.scanSource(s.id, { since: '2026-06-30' })
    // git 命中但扫描抛错 → 汇入 hint；claude probe 失败视为未命中，不产条目。
    expect(res.truncated).toBe(true)
    expect(res.truncatedHint).toContain('git')
    expect(res.entries).toEqual([])
  })

  it('无渠道时扫描返回空（不抛错）', async () => {
    const { svc } = makeService()
    const s = await svc.addSource({ path: '/a' })
    const res = await svc.scanSource(s.id, { since: '2026-06-30' })
    expect(res.entries).toEqual([])
    expect(res.truncated).toBe(false)
  })

  it('不存在的 source 抛 not found', async () => {
    const { svc } = makeService()
    await expect(svc.scanSource('nope' as SourceId, { since: 'x' })).rejects.toThrow(/not found/)
  })
})

describe('DailyLogService 类型与候选发现', () => {
  it('addSource 缺省探测类型：含 .git → code，无 → other', async () => {
    const repo = await makeTempDir(true)
    const plain = await makeTempDir(false)
    try {
      const { svc } = makeService()
      const code = await svc.addSource({ path: repo })
      const other = await svc.addSource({ path: plain })
      expect(code.type).toBe('code')
      expect(other.type).toBe('other')
    } finally {
      await rm(repo, { recursive: true, force: true })
      await rm(plain, { recursive: true, force: true })
    }
  })

  it('addSource 显式 type 优先于探测', async () => {
    const plain = await makeTempDir(false)
    try {
      const { svc } = makeService()
      const s = await svc.addSource({ path: plain, type: 'other' })
      expect(s.type).toBe('other')
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })

  it('listWorkspaceCandidates：type 判定 + dsh 命中 + git 徽标 + added', async () => {
    const repo = await makeTempDir(true)
    const plain = await makeTempDir(false)
    try {
      const { svc } = makeService({
        channels: [gitChannel],
        workspaceProjects: async () => [
          { path: repo, title: 'myapp', sessionIds: ['s1', 's2', 's3'] },
          { path: plain, title: 'docs', sessionIds: [] },
        ],
      })
      const before = await svc.listWorkspaceCandidates()
      expect(before[0]).toEqual(
        expect.objectContaining({
          type: 'code',
          title: 'myapp',
          detail: '3 个 DSH 会话',
          added: false,
          // 工作区项目 dsh 徽标恒亮；.git 存在 → git 亮；claude/codex 随机临时路径 → 暗。
          channels: expect.objectContaining({ dsh: true, git: true, claude: false, codex: false }),
        }),
      )
      expect(before[1]).toEqual(
        expect.objectContaining({
          type: 'other',
          title: 'docs',
          detail: undefined,
          added: false,
          channels: expect.objectContaining({ dsh: true, git: false }),
        }),
      )
      // 手动添加 repo（带尾斜杠）后，候选 added=true（路径归一化对比）。
      await svc.addSource({ path: repo + '/', label: 'myapp' })
      const after = await svc.listWorkspaceCandidates()
      expect(after[0]?.added).toBe(true)
      expect(after[1]?.added).toBe(false)
    } finally {
      await rm(repo, { recursive: true, force: true })
      await rm(plain, { recursive: true, force: true })
    }
  })

  it('listWorkspaceCandidates：无 workspaceProjects → 空候选', async () => {
    const { svc } = makeService()
    expect(await svc.listWorkspaceCandidates()).toEqual([])
  })
})


describe('DailyLogService 内置模板迁移 + prepare/save', () => {
  it('预置旧 mustache 内置模板 → 构造后覆盖为新骨架', async () => {
    const ctx = new Context()
    const templates = fakeTable<TemplateRecord>()
    templates.put('t-builtin' as TemplateId, {
      id: 't-builtin' as TemplateId,
      name: 'default',
      content: '# {{author.name}} 的{{reportType}}',
      isBuiltin: true,
      isDefault: true,
      updatedAt: 1,
    })
    const domain = { table: (n: string) => (n === 'templates' ? templates : undefined) } as never
    const fresh = new DailyLogService(ctx, { domain })
    const t = fresh.listTemplates().find((x) => x.isBuiltin)!
    expect(t.content).not.toContain('{{')
    expect(t.content).toContain('## 核心产出')
  })
  it('prepareReport 返回模板引导且不触发渠道扫描', async () => {
    const boom: ChannelProvider = { kind: 'git', probe: async () => true, scan: async () => { throw new Error('should not scan') } }
    const { svc } = makeService({ channels: [boom] })
    const s = await svc.addSource({ path: '/a', label: 'proj' })
    const r = await svc.prepareReport({ reportType: '周报', dateRange: { since: '2026-07-01' }, sourceIds: [s.id] })
    expect(r.sourceCount).toBe(1)
    expect(r.template.name).toBe('default')
    expect(r.template.skeletonSection).toContain('## 核心产出')
    expect(r.template.promptSection).toBeUndefined()
  })
  it('saveReport 落库 + 缺省标题回退', async () => {
    const { svc, reports } = makeService()
    const s = await svc.addSource({ path: '/a' })
    const rec = await svc.saveReport({ markdown: '# 正文', sourceIds: [s.id], dateRange: { since: '2026-07-01' }, reportType: '周报' })
    expect(reports.get(rec.id)?.markdown).toBe('# 正文')
    expect(rec.title).toBe('周报 · 2026-07-01')
  })
  it('saveReport 空正文被拒绝', async () => {
    const { svc } = makeService()
    const s = await svc.addSource({ path: '/a' })
    await expect(svc.saveReport({ markdown: '   ', sourceIds: [s.id], dateRange: { since: 'x' } })).rejects.toThrow(/正文不能为空/)
  })
})

describe('claude 会话目录 slug 编码', () => {
  it('非 [A-Za-z0-9] 逐字符 → -（不压缩）', () => {
    expect(encodeClaudeSlug('C:\\Users\\hake-\\CODE\\hake-app-2.0')).toBe('C--Users-hake--CODE-hake-app-2-0')
    expect(encodeClaudeSlug('D:/codes/dsh-desk-studio')).toBe('D--codes-dsh-desk-studio')
  })
})
