import { describe, expect, it } from 'vitest'
import {
  SAFE_KEY_RE, SNAPSHOT_BASE_ID, SNAPSHOT_INSTALL_ID, aliasKey, decodeKeyPart, decodeStorageKey,
  diagKey, encodeKeyPart, foldKey, ledgerKey, snapshotDeltaKey, storageKey, uniqueSnapshotDeltaKey,
} from '../src/storage-key.ts'

/**
 * 真实世界可能出现在键里的东西：会话 id、模型名、provider、别名，以及故意恶心的一批。
 * 任何一条让键逃出 SAFE_KEY_RE，都意味着真实后端会**拒绝这一次写入**（实测故障就是如此）。
 */
const HOSTILE_INPUTS = [
  'session-73a6fe67-b5a5-46f9-9d83-11f00f3ea536',
  's1#2', 'a#b#c', 'a/b', 'a\\b', '..', '.', '', ' ', 'a b', '-', '--', 'a-', '-a', '00',
  'A', 'ABC', 'DeepSeek', 'UPPER', 'a_b', '__', 'a__b', '___', '_005f',
  'deepseek\u0000v4f-x', 'claude-3.5-sonnet', 'gpt-4o', '*', '**', 'a*b', '%2e%2e',
  '中文模型', 'e\u0301', '👍', '\uD83D\uDE00', '\n', '\t', '\u007f', 'C:\\windows\\x',
  'x'.repeat(64), '${sessionId}#${seq}', "'; drop table; --", 'snap-200#delta',
]

const safe = (key: string): boolean => SAFE_KEY_RE.test(key)

describe('encodeKeyPart', () => {
  it('任何输入都落进 SAFE_KEY_RE', () => {
    for (const input of HOSTILE_INPUTS) {
      const encoded = encodeKeyPart(input)
      if (input === '') { expect(encoded).toBe(''); continue }
      expect(safe(encoded), `encodeKeyPart(${JSON.stringify(input)}) = ${JSON.stringify(encoded)}`).toBe(true)
    }
  })

  it('可逆（含空串、代理对、NUL、组合字符）', () => {
    for (const input of HOSTILE_INPUTS) {
      expect(decodeKeyPart(encodeKeyPart(input))).toBe(input)
    }
  })

  it('大小写不折叠成一个键（Windows / macOS 文件系统大小写不敏感）', () => {
    expect(encodeKeyPart('DeepSeek')).not.toBe(encodeKeyPart('deepseek'))
    expect(safe(encodeKeyPart('DeepSeek'))).toBe(true)
  })

  it('只放行小写与连字符，下划线一定被转义（保留为转义引导）', () => {
    expect(encodeKeyPart('a_b')).toBe('a_005fb')
    expect(encodeKeyPart('#')).toBe('_0023')
    expect(decodeKeyPart('a_005fb')).toBe('a_b')
    expect(() => decodeKeyPart('_empty')).toThrow() // `_` 后面必须是 4 位十六进制
  })
})

describe('storageKey', () => {
  it('单射：不同分片组合不会撞同一个键', () => {
    const tuples: Array<Array<string | number>> = [
      ['a', 'b__c'], ['a__b', 'c'], ['a', 'b', 'c'], ['a#b', 'c'], ['a', 'b#c'],
      ['a', 'b'], ['a', '2'], ['1', '23'], ['12', '3'], ['', ''], ['', 'a'], ['a', ''],
    ]
    const seen = new Map<string, string>()
    for (const tuple of tuples) {
      const key = storageKey(...tuple)
      expect(safe(key), `${JSON.stringify(tuple)} → ${JSON.stringify(key)}`).toBe(true)
      const previous = seen.get(key)
      expect(previous === undefined || previous === JSON.stringify(tuple)).toBe(true)
      seen.set(key, JSON.stringify(tuple))
    }
    expect(seen.size).toBe(tuples.length)
    // 数字分片按十进制字符串参与编码：同一个逻辑键写数字或写字符串等价（这是有意的）。
    expect(storageKey('a', 2)).toBe(storageKey('a', '2'))
  })

  it('可逆：解码后逐片还原（`__` 不会被分片内容伪造出来）', () => {
    expect(decodeStorageKey(storageKey('a', 'b__c'))).toEqual(['a', 'b__c'])
    expect(decodeStorageKey(storageKey('a__b', 'c'))).toEqual(['a__b', 'c'])
    expect(decodeStorageKey(storageKey('s1#2', 19))).toEqual(['s1#2', '19'])
    expect(decodeStorageKey(storageKey('中文', ''))).toEqual(['中文', ''])
  })

  it('空串分片不会产生空键（空键本身就不是合法存储键）', () => {
    expect(storageKey('')).toBe('_empty')
    expect(safe(storageKey(''))).toBe(true)
    expect(decodeStorageKey('_empty')).toEqual([''])
  })

  it('典型会话 id 原样保留（老水位记录继续命中）', () => {
    const id = 'session-73a6fe67-b5a5-46f9-9d83-11f00f3ea536'
    expect(foldKey(id)).toBe(id)
    expect(ledgerKey(id, 19)).toBe(`${id}__19`)
  })
})

describe('各表键构造器', () => {
  it('账本行键 = <sessionId>__<seq>，同一事件重复折叠是同一个键', () => {
    expect(ledgerKey('s1', 2)).toBe('s1__2')
    expect(ledgerKey('s1', 2)).toBe(ledgerKey('s1', 2))
    expect(ledgerKey('s1', 2)).not.toBe(ledgerKey('s1', 20))
    expect(ledgerKey('a__b', 1)).not.toBe(ledgerKey('a', 1))
    expect(safe(ledgerKey('s1#2', 0))).toBe(true)
  })

  it('别名键不再用 NUL，且可逆区分 (provider, rawModel)', () => {
    expect(aliasKey('deepseek', 'v4f-x')).toBe('deepseek__v4f-x')
    const hostile = aliasKey('relay', 'hy3\u0000x')
    expect(hostile.includes('\u0000')).toBe(false)
    expect(safe(hostile)).toBe(true)
    expect(decodeStorageKey(hostile)).toEqual(['relay', 'hy3\u0000x'])
    expect(aliasKey('a', 'b__c')).not.toBe(aliasKey('a__b', 'c'))
  })

  it('诊断键稳定于 (sessionId, kind)：同故障只落一个键', () => {
    const id = 'session-73a6fe67-b5a5-46f9-9d83-11f00f3ea536'
    expect(diagKey(id, 'session-read')).toBe(`diag__${id}__session-read`)
    expect(diagKey(id, 'session-read')).toBe(diagKey(id, 'session-read'))
    expect(diagKey(id, 'session-read')).not.toBe(diagKey(id, 'pricing-fetch'))
    expect(diagKey(id, 'session-read')).not.toBe(diagKey('other', 'session-read'))
    expect(safe(diagKey('a/b#c', 'session-read'))).toBe(true)
  })

  it('base / install 快照 id 是历史字面量且路径安全（老数据继续命中）', () => {
    expect(SNAPSHOT_INSTALL_ID).toBe('snap-install')
    expect(SNAPSHOT_BASE_ID).toBe('snap-base')
    expect(safe(SNAPSHOT_INSTALL_ID)).toBe(true)
    expect(safe(SNAPSHOT_BASE_ID)).toBe(true)
  })

  it('delta 快照键：确定、路径安全、键长恒定（不随条数增长）', () => {
    const at = 1_789_555_940_351
    const first = snapshotDeltaKey('custom-price', at)
    expect(first).toBe('snap__custom-price__1789555940351')
    expect(snapshotDeltaKey('custom-price', at)).toBe(first)
    expect(snapshotDeltaKey('custom-price', at + 1)).not.toBe(first)
    expect(snapshotDeltaKey('catalog-refresh', at)).not.toBe(first)
    expect(safe(first)).toBe(true)
    // 旧实现的链式键每追加一条 +6 字符，最终会撑爆文件系统单段上限。
    expect(snapshotDeltaKey('custom-price', at, 999).length).toBeLessThan(48)
  })

  it('uniqueSnapshotDeltaKey 在已占用的键上顺延，且始终安全', () => {
    const at = 1_789_555_940_351
    const taken = snapshotDeltaKey('custom-price', at)
    const next = uniqueSnapshotDeltaKey(new Set([taken]), 'custom-price', at)
    expect(next).not.toBe(taken)
    expect(safe(next)).toBe(true)
    const third = uniqueSnapshotDeltaKey(new Set([taken, next]), 'custom-price', at)
    expect(third).not.toBe(next)
    expect(safe(third)).toBe(true)
  })
})
