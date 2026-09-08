import { describe, expect, it } from 'vitest'
import { dailyLogDomain, reportRecordSchema, sourceRecordSchema, templateRecordSchema } from '../src/domain.ts'
import type { ReportId, SourceId, TemplateId } from '../src/types.ts'

describe('sourceRecordSchema', () => {
  const base = { id: 's1' as SourceId, type: 'code', label: 'repo', path: '/x', createdAt: 1, updatedAt: 2 }
  it('合法记录透传', () => {
    expect(sourceRecordSchema.parse(base)).toEqual(base)
  })
  it('旧记录缺 type → 解析补 other（升级兼容）', () => {
    const { type: _omit, ...legacy } = base
    expect(sourceRecordSchema.parse(legacy).type).toBe('other')
  })
  it('非法 type 被拒绝', () => {
    expect(() => sourceRecordSchema.parse({ ...base, type: 'nope' })).toThrow()
  })
  it('缺 author 可解析', () => {
    expect(sourceRecordSchema.parse(base).author).toBeUndefined()
  })
  it('旧记录残留 kind 字段经 passthrough 保留（供启动迁移读取）', () => {
    const parsed = sourceRecordSchema.parse({ ...base, kind: 'git' }) as { kind?: unknown }
    expect(parsed.kind).toBe('git')
  })
  it('缺 path 被拒绝', () => {
    expect(() => sourceRecordSchema.parse({ ...base, path: undefined })).toThrow()
  })
})

describe('reportRecordSchema', () => {
  const base = { id: 'r1' as ReportId, title: '周报', markdown: '# hi', sourceIds: ['s1'], dateRange: { since: '2026-06-30' }, createdAt: 1 }
  it('合法记录透传', () => {
    expect(reportRecordSchema.parse(base)).toEqual(base)
  })
  it('until 可选', () => {
    expect(reportRecordSchema.parse(base).dateRange.until).toBeUndefined()
  })
  it('缺 markdown 被拒绝', () => {
    expect(() => reportRecordSchema.parse({ ...base, markdown: undefined })).toThrow()
  })
  it('reportType 可选且保留', () => {
    const parsed = reportRecordSchema.parse({ ...base, reportType: '周报' })
    expect(parsed.reportType).toBe('周报')
  })
})

describe('templateRecordSchema', () => {
  const base = { id: 't1' as TemplateId, name: 'daily', content: 'x', isBuiltin: false, isDefault: false, updatedAt: 1 }
  it('合法记录透传', () => {
    expect(templateRecordSchema.parse(base)).toEqual(base)
  })
  it('缺 content 被拒绝', () => {
    expect(() => templateRecordSchema.parse({ ...base, content: undefined })).toThrow()
  })
})

describe('dailyLogDomain', () => {
  it('三张表齐全', () => {
    expect(Object.keys(dailyLogDomain.tables)).toEqual(['sources', 'reports', 'templates'])
  })
})
