/**
 * 存储键编码的不变量：**永远路径安全**、可逆、单射。
 *
 * 这些不是"实现细节"—— 后端把键当文件路径的一段，键非法 = 那一次写入直接抛错。
 * 边 id 曾经就是裸的逻辑 id（`memory:<id>|about|entity:<id>`），于是连边全哑。
 */

import { describe, expect, it } from 'vitest'
import {
  SAFE_KEY_RE, decodeKeyPart, decodeStorageKey, edgeKey, encodeKeyPart, storageKey,
} from '../src/storage-key.ts'

const SAMPLES = [
  'memory:5c384eb2-3cfe-4a17-86ea-18d332b93f76|about|entity:077382d0-67d7-456f-97ba-5f908f6932e4',
  'a b/c.d', 'Claude-3', '中文标题', 'x\u0000y', '__', '_0023', 'AbC', '', '-',
]

describe('memory 存储键编码', () => {
  it('任何逻辑键的编码结果都匹配后端的路径安全规则', () => {
    for (const raw of SAMPLES) {
      // 空分片的 encodeKeyPart 是空串；整键的非空由 storageKey 的哨兵保证（见下一条）。
      if (raw !== '') expect(SAFE_KEY_RE.test(encodeKeyPart(raw)), raw).toBe(true)
      expect(SAFE_KEY_RE.test(storageKey(raw)), raw).toBe(true)
    }
  })

  it('编码可逆（单分片与多分片都能解回原样）', () => {
    for (const raw of SAMPLES) expect(decodeKeyPart(encodeKeyPart(raw))).toBe(raw)
    expect(decodeStorageKey(storageKey('memory:m1', 'about', 'entity:e1')))
      .toEqual(['memory:m1', 'about', 'entity:e1'])
  })

  it('单射：不同逻辑键不会落到同一个存储键', () => {
    const seen = new Set([...SAMPLES, 'a|b', 'a_007cb', 'a:b', 'ab', 'a-b'].map((s) => encodeKeyPart(s)))
    expect(seen.size).toBe(SAMPLES.length + 5)
    // 多分片与"看起来像多分片"的单分片也不撞（分隔符只可能是编码器的产物）。
    expect(storageKey('a', 'b')).not.toBe(storageKey('a__b'))
  })

  it('空键有哨兵：既不非法也不与别的键撞', () => {
    expect(SAFE_KEY_RE.test(storageKey(''))).toBe(true)
    expect(storageKey('')).not.toBe(storageKey('a', ''))
    expect(decodeStorageKey(storageKey(''))).toEqual([''])
  })

  it('边 id（含 | 与 :）转成安全键，且不同边互不覆盖', () => {
    const about = edgeKey('memory:m1|about|entity:e1')
    const mentions = edgeKey('memory:m1|mentions|entity:e1')
    expect(SAFE_KEY_RE.test(about)).toBe(true)
    expect(about).not.toBe(mentions)
    expect(decodeStorageKey(about)).toEqual(['memory:m1|about|entity:e1'])
  })
})
