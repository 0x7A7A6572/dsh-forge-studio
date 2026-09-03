/**
 * 编辑器图片粘贴辅助（paste-image.ts）单元测试：
 * 过滤逻辑与 base64 转换正确性。
 */

import { describe, expect, it } from 'vitest'
import { fileToDataUrl, pickImageFiles } from '../src/client/core/paste-image.ts'
import type { ClipboardFileLike } from '../src/client/core/paste-image.ts'

describe('pickImageFiles', () => {
  it('只挑图片文件并保持顺序', () => {
    const list: ClipboardFileLike[] = [
      { type: 'image/png' },
      { type: 'text/plain' },
      { type: 'image/jpeg' },
      { type: 'application/pdf' },
    ]
    const picked = pickImageFiles({ files: list })
    expect(picked).toHaveLength(2)
    expect(picked[0]!.type).toBe('image/png')
    expect(picked[1]!.type).toBe('image/jpeg')
  })

  it('空/缺省 clipboard 返回空数组', () => {
    expect(pickImageFiles(undefined)).toEqual([])
    expect(pickImageFiles(null)).toEqual([])
    expect(pickImageFiles({})).toEqual([])
    expect(pickImageFiles({ files: null })).toEqual([])
  })
})

describe('fileToDataUrl', () => {
  it('把字节流编码为带 mime 的 data URL', async () => {
    const blob = new Blob([new Uint8Array([0x48, 0x69])], { type: 'image/png' })
    const url = await fileToDataUrl(blob)
    expect(url).toBe('data:image/png;base64,SGk=')
  })

  it('缺省 mime 回退 image/png', async () => {
    const blob = new Blob([new Uint8Array([0x00])])
    const url = await fileToDataUrl(blob)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('较大的字节流可完整往返', async () => {
    const bytes = new Uint8Array(200_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    const blob = new Blob([bytes], { type: 'image/webp' })
    const url = await fileToDataUrl(blob)
    expect(url.startsWith('data:image/webp;base64,')).toBe(true)
    const decoded = atob(url.slice(url.indexOf(',') + 1))
    expect(decoded.length).toBe(bytes.length)
    expect(decoded.charCodeAt(0)).toBe(0)
    expect(decoded.charCodeAt(bytes.length - 1)).toBe((bytes.length - 1) % 251)
  })
})
