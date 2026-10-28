/**
 * 附件引用与文件名规则：普通文件与图片共用 notes-assets 目录，
 * 引用前缀必须分开（notes-file:），扩展名只收 ascii 字母数字且限长。
 */
import { describe, expect, it } from 'vitest'
import {
  extensionOfNoteFileName,
  fileNameOfNoteFileSrc,
  isNoteFileSrc,
  isValidNoteFile,
  mediaTypeOfNoteFileName,
  noteFileSrc,
  sanitizeAttachmentOpenName,
} from '../packages/plugin-notes/src/note-file-ref.ts'

const FILE = '8a7b6c5d-1234-4abc-9def-0123456789ab.pdf'

describe('附件引用格式', () => {
  it('uuid + 扩展名才算合法文件名', () => {
    expect(isValidNoteFile(FILE)).toBe(true)
    expect(isValidNoteFile('8a7b6c5d-1234-4abc-9def-0123456789ab.bin')).toBe(true)
    expect(isValidNoteFile('../8a7b6c5d-1234-4abc-9def-0123456789ab.pdf')).toBe(false)
    expect(isValidNoteFile('8a7b6c5d-1234-4abc-9def-0123456789ab.PDF')).toBe(false)
    expect(isValidNoteFile('8a7b6c5d-1234-4abc-9def-0123456789ab')).toBe(false)
  })

  it('前缀与图片前缀互不串味', () => {
    expect(isNoteFileSrc(noteFileSrc(FILE))).toBe(true)
    expect(fileNameOfNoteFileSrc(noteFileSrc(FILE))).toBe(FILE)
    expect(isNoteFileSrc('notes-asset:8a7b6c5d-1234-4abc-9def-0123456789ab.png')).toBe(false)
    expect(isNoteFileSrc('https://example.com/a.pdf')).toBe(false)
  })
})

describe('extensionOfNoteFileName', () => {
  it('大小写归一、取最后一段扩展名', () => {
    expect(extensionOfNoteFileName('会议记录.PDF')).toBe('pdf')
    expect(extensionOfNoteFileName('archive.tar.gz')).toBe('gz')
  })

  it('无扩展名或非法字符回落 bin', () => {
    expect(extensionOfNoteFileName('无扩展名')).toBe('bin')
    expect(extensionOfNoteFileName('a.???')).toBe('bin')
  })

  it('超长扩展名截断到 10 位', () => {
    expect(extensionOfNoteFileName('a.abcdefghijklmnop')).toBe('abcdefghij')
  })
})

describe('mediaTypeOfNoteFileName', () => {
  it('可查看类型给浏览器渲染用', () => {
    expect(mediaTypeOfNoteFileName('简报.pdf')).toBe('application/pdf')
    expect(mediaTypeOfNoteFileName('readme.md')).toBe('text/markdown')
    expect(mediaTypeOfNoteFileName('shot.PNG')).toBe('image/png')
  })

  it('不认识或可执行的类型一律 octet-stream（避免在标签页里执行）', () => {
    expect(mediaTypeOfNoteFileName('evil.html')).toBe('application/octet-stream')
    expect(mediaTypeOfNoteFileName('evil.svg')).toBe('application/octet-stream')
    expect(mediaTypeOfNoteFileName('bundle.zip')).toBe('application/octet-stream')
  })
})

describe('sanitizeAttachmentOpenName', () => {
  it('只留叶子名，去掉路径与非法字符', () => {
    expect(sanitizeAttachmentOpenName('../../a/b.pdf', 'pdf')).toBe('b.pdf')
    expect(sanitizeAttachmentOpenName('bad<name>.txt', 'txt')).toBe('badname.txt')
  })

  it('空名或没有扩展名时用兜底名并补扩展名', () => {
    expect(sanitizeAttachmentOpenName('', 'pdf')).toBe('attachment.pdf')
    expect(sanitizeAttachmentOpenName('readme', 'txt')).toBe('readme.txt')
  })
})
