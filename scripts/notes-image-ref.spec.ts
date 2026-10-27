/**
 * 便签图片引用与内联图片规整的门禁：引用格式是正文与文件名的唯一契约，
 * 正则放宽一格就会把正文里的文字 data:image 也搬走；收紧一格就漏掉 <img width> 形态。
 */
import { describe, expect, it } from 'vitest'
import {
  fileNameOfNoteImageSrc,
  findInlineImages,
  isNoteImageSrc,
  isValidNoteImageFile,
  mediaTypeOfNoteImageFile,
  noteImageSrc,
  replaceInlineImages,
} from '../packages/plugin-notes/src/note-image-ref.ts'

const PNG = 'data:image/png;base64,aGVsbG8='
const JPG = 'data:image/jpeg;base64,aGVsbG8='

describe('引用格式', () => {
  it('uuid + 白名单扩展名才算合法文件名', () => {
    expect(isValidNoteImageFile('8a7b6c5d-1234-4abc-9def-0123456789ab.png')).toBe(true)
    expect(isValidNoteImageFile('8a7b6c5d-1234-4abc-9def-0123456789ab.jpeg')).toBe(true)
    expect(isValidNoteImageFile('../8a7b6c5d-1234-4abc-9def-0123456789ab.png')).toBe(false)
    expect(isValidNoteImageFile('8a7b6c5d-1234-4abc-9def-0123456789ab.bmp')).toBe(false)
    expect(isValidNoteImageFile('8A7B6C5D-1234-4ABC-9DEF-0123456789AB.png')).toBe(false)
  })

  it('前缀 + 白名单扩展名可解析回文件名', () => {
    const src = noteImageSrc('8a7b6c5d-1234-4abc-9def-0123456789ab.svg')
    expect(isNoteImageSrc(src)).toBe(true)
    expect(fileNameOfNoteImageSrc(src)).toBe('8a7b6c5d-1234-4abc-9def-0123456789ab.svg')
    expect(isNoteImageSrc('https://example.com/a.png')).toBe(false)
    expect(isNoteImageSrc('notes-asset:not-a-uuid.png')).toBe(false)
  })

  it('扩展名 ↔ 媒体类型双向映射一致', () => {
    expect(mediaTypeOfNoteImageFile('x.png')).toBe('image/png')
    expect(mediaTypeOfNoteImageFile('x.svg')).toBe('image/svg+xml')
    expect(mediaTypeOfNoteImageFile('x.exe')).toBeNull()
  })
})

describe('findInlineImages', () => {
  it('Markdown 图片目标', () => {
    const matches = findInlineImages(`前言\n![截图](${PNG})\n后文`)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.mediaType).toBe('image/png')
    expect(matches[0]?.base64).toBe('aGVsbG8=')
  })

  it('HTML img[src]（带 width 也命中）', () => {
    const matches = findInlineImages(`<img src="${JPG}" alt="" width="50%" />`)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.mediaType).toBe('image/jpeg')
    expect(matches[0]?.base64).toBe('aGVsbG8=')
  })

  it('多图按出现顺序返回', () => {
    const matches = findInlineImages(`![a](${PNG})\n![b](${JPG})`)
    expect(matches.map((match) => match.mediaType)).toEqual(['image/png', 'image/jpeg'])
  })

  it('http 图片、data:text、正文里的文字 data:image 都不算', () => {
    expect(findInlineImages('![a](https://example.com/a.png)')).toHaveLength(0)
    expect(findInlineImages('![a](data:text/plain;base64,aGVsbG8=)')).toHaveLength(0)
    expect(findInlineImages('示例：data:image/png;base64,aGVsbG8=')).toHaveLength(0)
  })
})

describe('replaceInlineImages', () => {
  it('只换 url，alt/title/width 原样保留', () => {
    const text = `![截图](${PNG} "标题")\n<img src="${JPG}" alt="" width="50%" />`
    const matches = findInlineImages(text)
    const output = replaceInlineImages(text, matches, ['a.png', 'b.jpg'])
    expect(output).toContain('![截图](notes-asset:a.png "标题")')
    expect(output).toContain('<img src="notes-asset:b.jpg" alt="" width="50%" />')
    expect(output).not.toContain('data:image')
  })

  it('数量不一致直接抛错（调用方 bug 不能静默错位）', () => {
    const matches = findInlineImages(`![a](${PNG})`)
    expect(() => replaceInlineImages('x', matches, [])).toThrow(/数量不一致/)
  })
})
