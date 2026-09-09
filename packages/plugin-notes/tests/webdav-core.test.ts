/**
 * core/webdav-core 纯函数单测：备份 payload 构建与校验、文件名、上传判定
 * （watermark）、远端 PROPFIND href 解析、保留份数清理选择。
 * 网络与配置读写不进单测（引擎层手动冒烟覆盖）。
 */

import { describe, expect, it } from 'vitest'
import {
  WEBDAV_BACKUP_SCHEMA,
  WEBDAV_PAYLOAD_VERSION,
  backupFileName,
  buildBackupPayload,
  compareSnapshotNamesDesc,
  filterBackupFiles,
  isBackupFileName,
  maxUpdatedAt,
  parseHrefs,
  selectPruneNames,
  shouldUpload,
  uniqueBackupName,
  validateBackupPayload,
} from '../src/webdav-core.ts'
import type { NoteId, NoteRecord } from '../src/types.ts'

function note(partial: Partial<NoteRecord> & { id: string }): NoteRecord {
  return {
    title: 't',
    text: 'b',
    pinned: false,
    archived: false,
    color: 'yellow',
    origin: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const id = (n: string) => n as NoteId

describe('backupFileName / isBackupFileName / filterBackupFiles', () => {
  it('文件名带可排序时间戳 notes-YYYYMMDD-HHmmss.json', () => {
    const at = new Date(2026, 5, 3, 9, 8, 7).getTime()
    const name = backupFileName(at)
    expect(name).toBe('notes-20260603-090807.json')
    expect(isBackupFileName(name)).toBe(true)
  })

  it('非本插件命名（其他文件/目录）不认作备份', () => {
    expect(isBackupFileName('notes-20260603-090807.json')).toBe(true)
    expect(isBackupFileName('foo.json')).toBe(false)
    expect(isBackupFileName('notes-2026-06-03.json')).toBe(false)
    expect(isBackupFileName('notes-20260603-090807-2.json')).toBe(true)
    expect(isBackupFileName('notes-20260603-090807.json.bak')).toBe(false)
  })

  it('filterBackupFiles 只保留本插件命名', () => {
    const files = ['notes-20260603-090807.json', 'a.txt', 'dir/', 'notes-20260603-091500.json']
    expect(filterBackupFiles(files).sort()).toEqual([
      'notes-20260603-090807.json',
      'notes-20260603-091500.json',
    ])
  })
})

describe('buildBackupPayload / validateBackupPayload', () => {
  it('payload 含 schema 标记、版本与导出时间', () => {
    const payload = buildBackupPayload([note({ id: id('a'), updatedAt: 5 })], 42)
    expect(payload.schema).toBe(WEBDAV_BACKUP_SCHEMA)
    expect(payload.version).toBe(WEBDAV_PAYLOAD_VERSION)
    expect(payload.exportedAt).toBe(42)
    expect(payload.notes).toHaveLength(1)
  })

  it('合法 payload 通过校验并原样返回', () => {
    const payload = buildBackupPayload([note({ id: id('a') })], 42)
    expect(validateBackupPayload(payload)).toEqual(payload)
  })

  it('拒绝缺 schema/版本不符/缺 exportedAt 的输入', () => {
    expect(() => validateBackupPayload({ notes: [] })).toThrow()
    expect(() => validateBackupPayload({ schema: 'x', version: 1, exportedAt: 1, notes: [] })).toThrow()
    expect(() => validateBackupPayload({ schema: WEBDAV_BACKUP_SCHEMA, version: 9, exportedAt: 1, notes: [] })).toThrow()
  })

  it('拒绝非法便签形状（颜色越界/缺 id/非数组）', () => {
    const base = { schema: WEBDAV_BACKUP_SCHEMA, version: WEBDAV_PAYLOAD_VERSION, exportedAt: 1 }
    expect(() => validateBackupPayload({ ...base, notes: [note({ id: id('a'), color: 'red' as never })] })).toThrow()
    expect(() => validateBackupPayload({ ...base, notes: [{ title: 'x' }] })).toThrow()
    expect(() => validateBackupPayload({ ...base, notes: 'nope' })).toThrow()
  })
})

describe('maxUpdatedAt / shouldUpload（有变更才传）', () => {
  it('maxUpdatedAt：无便签 0，否则取最大 updatedAt', () => {
    expect(maxUpdatedAt([])).toBe(0)
    expect(
      maxUpdatedAt([
        note({ id: id('a'), updatedAt: 3 }),
        note({ id: id('b'), updatedAt: 9 }),
      ]),
    ).toBe(9)
  })

  it('shouldUpload：最新 updatedAt 高于已传水位才需要传', () => {
    expect(shouldUpload(9, 3)).toBe(true)
    expect(shouldUpload(3, 9)).toBe(false)
    expect(shouldUpload(9, 9)).toBe(false)
    expect(shouldUpload(1, 0)).toBe(true)
  })
})

describe('compareSnapshotNamesDesc / selectPruneNames（同秒序与保留）', () => {
  it('同秒内：-N 后缀更大的更新，排最前；跨秒按时间戳', () => {
    const plain = 'notes-20260603-090807.json'
    const second = 'notes-20260603-090807-2.json'
    const first = 'notes-20260603-090806.json'
    expect(compareSnapshotNamesDesc(second, plain)).toBeLessThan(0) // second 更新 → 更前
    expect(compareSnapshotNamesDesc(plain, second)).toBeGreaterThan(0)
    expect(compareSnapshotNamesDesc(plain, first)).toBeLessThan(0)
  })

  it('selectPruneNames 保留同秒内真正最新的（带更大后缀的），删最旧', () => {
    const plain = 'notes-20260603-090807.json'
    const second = 'notes-20260603-090807-2.json'
    const oldest = 'notes-20260603-090806.json'
    const prune = selectPruneNames([plain, second, oldest], 2)
    expect(prune).toEqual([oldest])
  })
})

describe('uniqueBackupName（同秒撞名去重）', () => {
  it('无冲突直接用原名；冲突依次加 -2/-3… 后缀', () => {
    expect(uniqueBackupName('notes-20260603-090807.json', ['a.json'])).toBe('notes-20260603-090807.json')
    const existing = ['notes-20260603-090807.json', 'notes-20260603-090807-2.json']
    expect(uniqueBackupName('notes-20260603-090807.json', existing)).toBe('notes-20260603-090807-3.json')
  })
  it('接受 Set 输入', () => {
    const set = new Set(['notes-20260603-090807.json'])
    expect(uniqueBackupName('notes-20260603-090807.json', set)).toBe('notes-20260603-090807-2.json')
  })
})

describe('parseHrefs / selectPruneNames（远端目录解析与保留）', () => {
  it('从 PROPFIND multistatus XML 提取 href（兼容带命名空间前缀/实体）', () => {
    const xml =
      '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
      '<D:response><D:href>/dav/dsh/notes/notes-20260603-090807.json</D:href></D:response>' +
      '<D:response><D:href>/dav/dsh/notes/notes-20260603-091500.json</D:href></D:response>' +
      '<D:response><D:href>/dav/dsh/notes/</D:href></D:response></D:multistatus>'
    expect(parseHrefs(xml)).toEqual([
      '/dav/dsh/notes/notes-20260603-090807.json',
      '/dav/dsh/notes/notes-20260603-091500.json',
      '/dav/dsh/notes/',
    ])
  })

  it('无前缀 href 也能解析', () => {
    const xml = '<multistatus><response><href>/x.json</href></response></multistatus>'
    expect(parseHrefs(xml)).toEqual(['/x.json'])
  })

  it('selectPruneNames：按时间戳保留最近 keep 份，其余删除', () => {
    const files = filterBackupFiles([
      'notes-20260603-090807.json',
      'notes-20260603-091500.json',
      'notes-20260603-092000.json',
      'notes-20260603-093000.json',
    ])
    const prune = selectPruneNames(files, 2)
    expect(prune.sort()).toEqual(['notes-20260603-090807.json', 'notes-20260603-091500.json'])
  })

  it('份数不足 keep 时不清理任何文件', () => {
    expect(selectPruneNames(['notes-20260603-090807.json'], 5)).toEqual([])
  })
})